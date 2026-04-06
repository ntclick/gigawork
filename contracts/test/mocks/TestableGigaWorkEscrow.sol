// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./TestableGigaWorkRegistry.sol";

/// @notice Testable version of GigaWorkEscrow that accepts custom USDC + Registry addresses
contract TestableGigaWorkEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public usdc;

    uint256 public constant FEE_BPS = 500;
    uint256 public constant AUTO_SETTLE_DELAY = 24 hours;
    uint256 public constant BUFFER_BPS = 12000;

    enum JobStatus {
        OPEN,
        MATCHING,
        FUNDED,
        IN_PROGRESS,
        PENDING_REVIEW,
        SETTLED,
        DISPUTED,
        EXPIRED
    }

    enum JobType {
        ONCHAIN,
        OFFCHAIN_AI,
        SCRAPING,
        WORKFLOW
    }

    struct Job {
        uint256 jobId;
        address employer;
        address workerAgent;
        JobType jobType;
        uint256 hourlyRateUSDC;
        uint256 estimatedHours;
        uint256 depositAmount;
        uint256 startTimestamp;
        uint256 endTimestamp;
        uint256 resultSubmittedAt;
        bytes32 resultHash;
        string proofURI;
        bytes spec;
        JobStatus status;
        int256 employerRating;
    }

    struct Bid {
        address agent;
        uint256 proposedRate;
        string note;
        bool accepted;
    }

    TestableGigaWorkRegistry public registry;
    address public treasury;

    uint256 private _nextJobId;
    mapping(uint256 => Job) public jobs;
    mapping(uint256 => Bid[]) public bids;

    event JobPosted(
        uint256 indexed jobId, address indexed employer, JobType jobType, uint256 estimatedHours, uint256 deposit
    );
    event BidSubmitted(uint256 indexed jobId, address indexed agent, uint256 proposedRate);
    event BidAccepted(uint256 indexed jobId, address indexed worker, uint256 agreedRate);
    event EscrowFunded(uint256 indexed jobId, uint256 amount);
    event ResultSubmitted(uint256 indexed jobId, address indexed worker, bytes32 resultHash);
    event JobSettled(uint256 indexed jobId, uint256 workerPayout, uint256 platformFee, uint256 refund);
    event DisputeRaised(uint256 indexed jobId, address indexed raisedBy, string reason);
    event DisputeResolved(uint256 indexed jobId, bool workerWon);

    error InvalidStatus(JobStatus current, JobStatus expected);
    error NotEmployer();
    error NotWorker();
    error NotParty();
    error InsufficientDeposit();
    error TooEarlyToAutoSettle();
    error AgentNotActive();
    error InvalidEstimatedHours();

    constructor(address _usdc, address _registry, address _treasury) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        registry = TestableGigaWorkRegistry(_registry);
        treasury = _treasury;
    }

    function postJob(JobType jobType, uint256 estimatedHours, address agentAddress, bytes calldata spec)
        external
        nonReentrant
        returns (uint256 jobId)
    {
        if (estimatedHours == 0) revert InvalidEstimatedHours();

        jobId = _nextJobId++;

        uint256 rate = 0;
        if (agentAddress != address(0)) {
            TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(agentAddress);
            if (!p.isActive) revert AgentNotActive();
            rate = p.hourlyRateUSDC;
        }

        uint256 deposit = rate > 0 ? (rate * estimatedHours * BUFFER_BPS) / 10_000 : 0;

        jobs[jobId] = Job({
            jobId: jobId,
            employer: msg.sender,
            workerAgent: agentAddress,
            jobType: jobType,
            hourlyRateUSDC: rate,
            estimatedHours: estimatedHours,
            depositAmount: deposit,
            startTimestamp: 0,
            endTimestamp: 0,
            resultSubmittedAt: 0,
            resultHash: bytes32(0),
            proofURI: "",
            spec: spec,
            status: JobStatus.OPEN,
            employerRating: 0
        });

        if (deposit > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), deposit);
            jobs[jobId].status = JobStatus.MATCHING;
            emit EscrowFunded(jobId, deposit);
        }

        emit JobPosted(jobId, msg.sender, jobType, estimatedHours, deposit);
    }

    function acceptBid(uint256 jobId, address worker) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.employer != msg.sender) revert NotEmployer();
        if (job.status != JobStatus.OPEN && job.status != JobStatus.MATCHING) {
            revert InvalidStatus(job.status, JobStatus.MATCHING);
        }

        TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(worker);
        if (!p.isActive) revert AgentNotActive();

        uint256 agreedRate = p.hourlyRateUSDC;
        uint256 requiredDeposit = (agreedRate * job.estimatedHours * BUFFER_BPS) / 10_000;

        if (job.depositAmount < requiredDeposit) {
            uint256 topUp = requiredDeposit - job.depositAmount;
            usdc.safeTransferFrom(msg.sender, address(this), topUp);
            job.depositAmount = requiredDeposit;
            emit EscrowFunded(jobId, topUp);
        }

        job.workerAgent = worker;
        job.hourlyRateUSDC = agreedRate;
        job.startTimestamp = block.timestamp;
        job.status = JobStatus.IN_PROGRESS;

        Bid[] storage jobBids = bids[jobId];
        for (uint256 i = 0; i < jobBids.length; i++) {
            if (jobBids[i].agent == worker) {
                jobBids[i].accepted = true;
                break;
            }
        }

        emit BidAccepted(jobId, worker, agreedRate);
    }

    function approveResult(uint256 jobId, int256 rating) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.employer != msg.sender) revert NotEmployer();
        if (job.status != JobStatus.PENDING_REVIEW) {
            revert InvalidStatus(job.status, JobStatus.PENDING_REVIEW);
        }

        job.employerRating = rating;
        _settle(jobId);
    }

    function raiseDispute(uint256 jobId, string calldata reason) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.employer && msg.sender != job.workerAgent) revert NotParty();
        if (job.status != JobStatus.IN_PROGRESS && job.status != JobStatus.PENDING_REVIEW) {
            revert InvalidStatus(job.status, JobStatus.IN_PROGRESS);
        }

        job.status = JobStatus.DISPUTED;
        emit DisputeRaised(jobId, msg.sender, reason);
    }

    function bid(uint256 jobId, string calldata note) external {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.OPEN) revert InvalidStatus(job.status, JobStatus.OPEN);

        TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(msg.sender);
        if (!p.isActive) revert AgentNotActive();

        bids[jobId].push(Bid({agent: msg.sender, proposedRate: p.hourlyRateUSDC, note: note, accepted: false}));

        emit BidSubmitted(jobId, msg.sender, p.hourlyRateUSDC);
    }

    function submitResult(uint256 jobId, bytes32 resultHash, string calldata proofURI) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.workerAgent != msg.sender) revert NotWorker();
        if (job.status != JobStatus.IN_PROGRESS) {
            revert InvalidStatus(job.status, JobStatus.IN_PROGRESS);
        }

        job.endTimestamp = block.timestamp;
        job.resultHash = resultHash;
        job.proofURI = proofURI;
        job.resultSubmittedAt = block.timestamp;
        job.status = JobStatus.PENDING_REVIEW;

        emit ResultSubmitted(jobId, msg.sender, resultHash);
    }

    function autoSettle(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.PENDING_REVIEW) {
            revert InvalidStatus(job.status, JobStatus.PENDING_REVIEW);
        }
        if (block.timestamp < job.resultSubmittedAt + AUTO_SETTLE_DELAY) {
            revert TooEarlyToAutoSettle();
        }

        job.employerRating = 75;
        _settle(jobId);
    }

    function resolveDispute(uint256 jobId, bool workerWon) external onlyOwner nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.DISPUTED) {
            revert InvalidStatus(job.status, JobStatus.DISPUTED);
        }

        if (workerWon) {
            job.employerRating = 50;
            _settle(jobId);
        } else {
            uint256 refund = job.depositAmount;
            job.depositAmount = 0;
            job.status = JobStatus.EXPIRED;
            usdc.safeTransfer(job.employer, refund);
        }

        emit DisputeResolved(jobId, workerWon);
    }

    function _settle(uint256 jobId) internal {
        Job storage job = jobs[jobId];

        uint256 actualHours = (job.endTimestamp - job.startTimestamp) / 3600;
        if (actualHours == 0) actualHours = 1;

        uint256 actualCharge = job.hourlyRateUSDC * actualHours;
        if (actualCharge > job.depositAmount) {
            actualCharge = job.depositAmount;
        }

        uint256 fee = (actualCharge * FEE_BPS) / 10_000;
        uint256 workerPay = actualCharge - fee;
        uint256 refund = job.depositAmount - actualCharge;

        job.depositAmount = 0;
        job.status = JobStatus.SETTLED;

        if (fee > 0) usdc.safeTransfer(treasury, fee);
        if (workerPay > 0) usdc.safeTransfer(job.workerAgent, workerPay);
        if (refund > 0) usdc.safeTransfer(job.employer, refund);

        int256 scoreDelta = job.employerRating / 10;
        registry.recordJobCompletion(job.workerAgent, workerPay, scoreDelta);

        emit JobSettled(jobId, workerPay, fee, refund);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    function getBids(uint256 jobId) external view returns (Bid[] memory) {
        return bids[jobId];
    }

    function totalJobs() external view returns (uint256) {
        return _nextJobId;
    }
}
