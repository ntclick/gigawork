// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../../src/interfaces/IERC8183.sol";
import "./TestableGigaWorkRegistry.sol";

/// @notice Testable version of GigaWorkCommerce that accepts custom USDC + Registry addresses
contract TestableGigaWorkCommerce is IERC8183, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public usdc;
    uint256 public constant FEE_BPS = 500;

    TestableGigaWorkRegistry public registry;
    address public treasury;
    uint256 private _nextJobId;

    struct Job {
        address client;
        address provider;
        address evaluator;
        uint256 budget;
        uint256 expiredAt;
        string description;
        bytes32 deliverable;
        JobStatus status;
    }

    mapping(uint256 => Job) public jobs;

    struct Bid {
        address agent;
        uint256 proposedRate;
        string note;
        bool accepted;
    }
    mapping(uint256 => Bid[]) public bids;

    event BidSubmitted(uint256 indexed jobId, address indexed agent, uint256 proposedRate);
    event BidAccepted(uint256 indexed jobId, address indexed worker, uint256 agreedRate);

    error InvalidStatus(JobStatus current, JobStatus expected);
    error NotClient();
    error NotProvider();
    error NotEvaluator();
    error NotClientOrProvider();
    error NotClientOrEvaluator();
    error ProviderAlreadySet();
    error ProviderNotSet();
    error ZeroEvaluator();
    error ZeroProvider();
    error BudgetNotSet();
    error BudgetMismatch();
    error NotExpired();
    error AgentNotActive();

    constructor(address _usdc, address _registry, address _treasury) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        registry = TestableGigaWorkRegistry(_registry);
        treasury = _treasury;
    }

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        bytes calldata
    ) external override nonReentrant returns (uint256 jobId) {
        if (evaluator == address(0)) revert ZeroEvaluator();
        require(expiredAt > block.timestamp, "expiredAt must be in future");

        jobId = _nextJobId++;
        jobs[jobId] = Job({
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            budget: 0,
            expiredAt: expiredAt,
            description: description,
            deliverable: bytes32(0),
            status: JobStatus.Open
        });

        emit JobCreated(jobId, msg.sender, provider, evaluator);
    }

    function setProvider(uint256 jobId, address provider, bytes calldata) external override {
        Job storage job = jobs[jobId];
        if (job.client != msg.sender) revert NotClient();
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);
        if (job.provider != address(0)) revert ProviderAlreadySet();
        if (provider == address(0)) revert ZeroProvider();
        job.provider = provider;
        emit ProviderSet(jobId, provider);
    }

    function setBudget(uint256 jobId, uint256 amount, bytes calldata) external override {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);
        if (msg.sender != job.client && msg.sender != job.provider) revert NotClientOrProvider();
        job.budget = amount;
        emit BudgetSet(jobId, amount, msg.sender);
    }

    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata) external override nonReentrant {
        Job storage job = jobs[jobId];
        if (job.client != msg.sender) revert NotClient();
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);
        if (job.budget == 0) revert BudgetNotSet();
        if (job.provider == address(0)) revert ProviderNotSet();
        if (job.budget != expectedBudget) revert BudgetMismatch();

        usdc.safeTransferFrom(msg.sender, address(this), job.budget);
        job.status = JobStatus.Funded;
        emit JobFunded(jobId, job.budget);
    }

    function submit(uint256 jobId, bytes32 deliverable, bytes calldata) external override nonReentrant {
        Job storage job = jobs[jobId];
        if (job.provider != msg.sender) revert NotProvider();
        if (job.status != JobStatus.Funded) revert InvalidStatus(job.status, JobStatus.Funded);
        job.deliverable = deliverable;
        job.status = JobStatus.Submitted;
        emit JobSubmitted(jobId, deliverable);
    }

    function complete(uint256 jobId, bytes32 reason, bytes calldata) external override nonReentrant {
        Job storage job = jobs[jobId];
        if (job.evaluator != msg.sender) revert NotEvaluator();
        if (job.status != JobStatus.Submitted) revert InvalidStatus(job.status, JobStatus.Submitted);

        job.status = JobStatus.Completed;

        uint256 fee = (job.budget * FEE_BPS) / 10_000;
        uint256 payout = job.budget - fee;

        if (fee > 0) usdc.safeTransfer(treasury, fee);
        if (payout > 0) usdc.safeTransfer(job.provider, payout);

        try registry.recordJobCompletion(job.provider, payout, 10) {} catch {}

        emit JobCompleted(jobId, reason);
    }

    function reject(uint256 jobId, bytes32 reason, bytes calldata) external override nonReentrant {
        Job storage job = jobs[jobId];

        if (job.status == JobStatus.Open) {
            if (msg.sender != job.client) revert NotClient();
        } else if (job.status == JobStatus.Funded || job.status == JobStatus.Submitted) {
            if (msg.sender != job.evaluator) revert NotEvaluator();
            if (job.budget > 0) {
                usdc.safeTransfer(job.client, job.budget);
            }
        } else {
            revert InvalidStatus(job.status, JobStatus.Open);
        }

        job.status = JobStatus.Rejected;
        emit JobRejected(jobId, reason, msg.sender);
    }

    function claimRefund(uint256 jobId) external override nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) {
            revert InvalidStatus(job.status, JobStatus.Funded);
        }
        if (block.timestamp < job.expiredAt) revert NotExpired();

        uint256 refund = job.budget;
        job.budget = 0;
        job.status = JobStatus.Expired;

        if (refund > 0) usdc.safeTransfer(job.client, refund);
        emit JobRefunded(jobId);
    }

    function bid(uint256 jobId, string calldata note) external {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);

        TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(msg.sender);
        if (!p.isActive) revert AgentNotActive();

        bids[jobId].push(Bid({agent: msg.sender, proposedRate: p.hourlyRateUSDC, note: note, accepted: false}));
        emit BidSubmitted(jobId, msg.sender, p.hourlyRateUSDC);
    }

    function acceptBid(uint256 jobId, address worker, uint256 budget) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.client != msg.sender) revert NotClient();
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);

        TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(worker);
        if (!p.isActive) revert AgentNotActive();

        job.provider = worker;
        job.budget = budget;

        Bid[] storage jobBids = bids[jobId];
        for (uint256 i = 0; i < jobBids.length; i++) {
            if (jobBids[i].agent == worker) {
                jobBids[i].accepted = true;
                break;
            }
        }

        emit ProviderSet(jobId, worker);
        emit BudgetSet(jobId, budget, msg.sender);
        emit BidAccepted(jobId, worker, p.hourlyRateUSDC);
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
