// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGigaWorkRegistry {
    struct AgentProfile {
        uint256 erc8004TokenId;
        address owner;
        uint256 hourlyRateUSDC;
        string[] skillTags;
        uint256 reputationScore;
        uint256 totalJobsDone;
        uint256 totalEarnedUSDC;
        bool isActive;
        uint256 registeredAt;
    }

    function getProfile(address agent) external view returns (AgentProfile memory);
    function recordJobCompletion(address agent, uint256 earnedUSDC, int256 scoreDelta) external;
}

contract GigaWorkEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────
    IERC20 public constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    uint256 public constant FEE_BPS = 500; // 5% platform fee
    uint256 public constant AUTO_SETTLE_DELAY = 24 hours;
    uint256 public constant BUFFER_BPS = 12000; // deposit = rate × hours × 1.2

    // ─── Enums ───────────────────────────────────────────────
    enum JobStatus {
        OPEN, // 0 — job posted, awaiting bid
        MATCHING, // 1 — bid accepted, escrow not yet funded
        FUNDED, // 2 — USDC locked in escrow
        IN_PROGRESS, // 3 — worker executing
        PENDING_REVIEW, // 4 — result submitted, awaiting approval
        SETTLED, // 5 — complete, funds distributed
        DISPUTED, // 6 — under arbitration
        EXPIRED // 7 — past deadline, auto-refunded
    }

    enum JobType {
        ONCHAIN,
        OFFCHAIN_AI,
        SCRAPING,
        WORKFLOW
    }

    // ─── Structs ─────────────────────────────────────────────
    struct Job {
        uint256 jobId;
        address employer;
        address workerAgent;
        JobType jobType;
        uint256 hourlyRateUSDC; // agreed rate (6 dec)
        uint256 estimatedHours;
        uint256 depositAmount; // USDC held in escrow
        uint256 startTimestamp;
        uint256 endTimestamp;
        uint256 resultSubmittedAt;
        bytes32 resultHash;
        string proofURI; // IPFS proof
        bytes spec; // encoded job specification
        JobStatus status;
        int256 employerRating; // -100 to +100
    }

    struct Bid {
        address agent;
        uint256 proposedRate;
        string note;
        bool accepted;
    }

    // ─── State ───────────────────────────────────────────────
    IGigaWorkRegistry public registry;
    address public treasury;

    uint256 private _nextJobId;
    mapping(uint256 => Job) public jobs;
    mapping(uint256 => Bid[]) public bids;

    // ─── Events ──────────────────────────────────────────────
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

    // ─── Errors ──────────────────────────────────────────────
    error InvalidStatus(JobStatus current, JobStatus expected);
    error NotEmployer();
    error NotWorker();
    error NotParty();
    error InsufficientDeposit();
    error TooEarlyToAutoSettle();
    error AgentNotActive();
    error InvalidEstimatedHours();

    // ─── Constructor ─────────────────────────────────────────
    constructor(address _registry, address _treasury) Ownable(msg.sender) {
        registry = IGigaWorkRegistry(_registry);
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════════════
    //  EMPLOYER FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /// @notice Post a new job and optionally deposit USDC escrow.
    /// @param jobType       Type of job (ONCHAIN, OFFCHAIN_AI, SCRAPING, WORKFLOW)
    /// @param estimatedHours Employer's estimate (used to calculate deposit)
    /// @param agentAddress   Optional: invite specific agent (address(0) = open market)
    /// @param spec           Encoded job specification
    function postJob(JobType jobType, uint256 estimatedHours, address agentAddress, bytes calldata spec)
        external
        nonReentrant
        returns (uint256 jobId)
    {
        if (estimatedHours == 0) revert InvalidEstimatedHours();

        jobId = _nextJobId++;

        // If inviting specific agent, use their rate
        uint256 rate = 0;
        if (agentAddress != address(0)) {
            IGigaWorkRegistry.AgentProfile memory p = registry.getProfile(agentAddress);
            if (!p.isActive) revert AgentNotActive();
            rate = p.hourlyRateUSDC;
        }

        // deposit = rate × hours × 1.2 buffer
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
            USDC.safeTransferFrom(msg.sender, address(this), deposit);
            jobs[jobId].status = JobStatus.MATCHING;
            emit EscrowFunded(jobId, deposit);
        }

        emit JobPosted(jobId, msg.sender, jobType, estimatedHours, deposit);
    }

    /// @notice Accept a bid from a Worker Agent.
    function acceptBid(uint256 jobId, address worker) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.employer != msg.sender) revert NotEmployer();
        if (job.status != JobStatus.OPEN && job.status != JobStatus.MATCHING) {
            revert InvalidStatus(job.status, JobStatus.MATCHING);
        }

        IGigaWorkRegistry.AgentProfile memory p = registry.getProfile(worker);
        if (!p.isActive) revert AgentNotActive();

        uint256 agreedRate = p.hourlyRateUSDC;
        uint256 requiredDeposit = (agreedRate * job.estimatedHours * BUFFER_BPS) / 10_000;

        // Top up escrow if not enough
        if (job.depositAmount < requiredDeposit) {
            uint256 topUp = requiredDeposit - job.depositAmount;
            USDC.safeTransferFrom(msg.sender, address(this), topUp);
            job.depositAmount = requiredDeposit;
            emit EscrowFunded(jobId, topUp);
        }

        job.workerAgent = worker;
        job.hourlyRateUSDC = agreedRate;
        job.startTimestamp = block.timestamp;
        job.status = JobStatus.IN_PROGRESS;

        // Mark bid as accepted
        Bid[] storage jobBids = bids[jobId];
        for (uint256 i = 0; i < jobBids.length; i++) {
            if (jobBids[i].agent == worker) {
                jobBids[i].accepted = true;
                break;
            }
        }

        emit BidAccepted(jobId, worker, agreedRate);
    }

    /// @notice Approve result and trigger settlement.
    function approveResult(uint256 jobId, int256 rating) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.employer != msg.sender) revert NotEmployer();
        if (job.status != JobStatus.PENDING_REVIEW) {
            revert InvalidStatus(job.status, JobStatus.PENDING_REVIEW);
        }

        job.employerRating = rating;
        _settle(jobId);
    }

    /// @notice Raise a dispute. Either party can call.
    function raiseDispute(uint256 jobId, string calldata reason) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.employer && msg.sender != job.workerAgent) revert NotParty();
        if (job.status != JobStatus.IN_PROGRESS && job.status != JobStatus.PENDING_REVIEW) {
            revert InvalidStatus(job.status, JobStatus.IN_PROGRESS);
        }

        job.status = JobStatus.DISPUTED;
        emit DisputeRaised(jobId, msg.sender, reason);
    }

    // ═══════════════════════════════════════════════════════════
    //  WORKER FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /// @notice Worker submits a bid on an open job.
    function bid(uint256 jobId, string calldata note) external {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.OPEN) revert InvalidStatus(job.status, JobStatus.OPEN);

        IGigaWorkRegistry.AgentProfile memory p = registry.getProfile(msg.sender);
        if (!p.isActive) revert AgentNotActive();

        bids[jobId].push(Bid({agent: msg.sender, proposedRate: p.hourlyRateUSDC, note: note, accepted: false}));

        emit BidSubmitted(jobId, msg.sender, p.hourlyRateUSDC);
    }

    /// @notice Worker submits result hash + proof URI.
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

    // ═══════════════════════════════════════════════════════════
    //  AUTO-SETTLE
    // ═══════════════════════════════════════════════════════════

    /// @notice Anyone can call this after 24h employer silence.
    function autoSettle(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.PENDING_REVIEW) {
            revert InvalidStatus(job.status, JobStatus.PENDING_REVIEW);
        }
        if (block.timestamp < job.resultSubmittedAt + AUTO_SETTLE_DELAY) {
            revert TooEarlyToAutoSettle();
        }

        job.employerRating = 75; // neutral positive for auto-settle
        _settle(jobId);
    }

    // ═══════════════════════════════════════════════════════════
    //  ARBITRATION (owner = GigaWork multisig)
    // ═══════════════════════════════════════════════════════════

    /// @notice Resolve a dispute. workerWon=true releases to worker, false refunds employer.
    function resolveDispute(uint256 jobId, bool workerWon) external onlyOwner nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.DISPUTED) {
            revert InvalidStatus(job.status, JobStatus.DISPUTED);
        }

        if (workerWon) {
            job.employerRating = 50;
            _settle(jobId);
        } else {
            // Full refund to employer
            uint256 refund = job.depositAmount;
            job.depositAmount = 0;
            job.status = JobStatus.EXPIRED;
            USDC.safeTransfer(job.employer, refund);
        }

        emit DisputeResolved(jobId, workerWon);
    }

    // ═══════════════════════════════════════════════════════════
    //  INTERNAL SETTLEMENT
    // ═══════════════════════════════════════════════════════════

    function _settle(uint256 jobId) internal {
        Job storage job = jobs[jobId];

        // Calculate actual charge: rate × actual_hours
        uint256 actualHours = (job.endTimestamp - job.startTimestamp) / 3600;
        if (actualHours == 0) actualHours = 1; // minimum 1 hour

        uint256 actualCharge = job.hourlyRateUSDC * actualHours;
        if (actualCharge > job.depositAmount) {
            actualCharge = job.depositAmount; // cap at deposit
        }

        uint256 fee = (actualCharge * FEE_BPS) / 10_000;
        uint256 workerPay = actualCharge - fee;
        uint256 refund = job.depositAmount - actualCharge;

        job.depositAmount = 0;
        job.status = JobStatus.SETTLED;

        // Distribute funds
        if (fee > 0) USDC.safeTransfer(treasury, fee);
        if (workerPay > 0) USDC.safeTransfer(job.workerAgent, workerPay);
        if (refund > 0) USDC.safeTransfer(job.employer, refund);

        // Update registry reputation
        int256 scoreDelta = job.employerRating / 10;
        registry.recordJobCompletion(job.workerAgent, workerPay, scoreDelta);

        emit JobSettled(jobId, workerPay, fee, refund);
    }

    // ═══════════════════════════════════════════════════════════
    //  VIEWS
    // ═══════════════════════════════════════════════════════════

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
