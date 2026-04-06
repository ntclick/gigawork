// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IERC8183.sol";

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

/// @title GigaWorkCommerce — ERC-8183 Compliant Agentic Commerce
/// @notice Implements the Agentic Commerce Protocol (ERC-8183) for the GigaWork marketplace.
/// @dev State: Open → Funded → Submitted → Completed | Rejected | Expired
contract GigaWorkCommerce is IERC8183, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────
    IERC20 public constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 public constant FEE_BPS = 500; // 5% platform fee

    // ─── State ───────────────────────────────────────────────
    IGigaWorkRegistry public registry;
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

    // ─── Legacy Compatibility ────────────────────────────────
    // Bid system from old GigaWorkEscrow for marketplace flow
    struct Bid {
        address agent;
        uint256 proposedRate;
        string note;
        bool accepted;
    }
    mapping(uint256 => Bid[]) public bids;

    event BidSubmitted(uint256 indexed jobId, address indexed agent, uint256 proposedRate);
    event BidAccepted(uint256 indexed jobId, address indexed worker, uint256 agreedRate);

    // ─── Errors ──────────────────────────────────────────────
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

    // ─── Constructor ─────────────────────────────────────────
    constructor(address _registry, address _treasury) Ownable(msg.sender) {
        registry = IGigaWorkRegistry(_registry);
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════════════
    //  ERC-8183 CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /// @inheritdoc IERC8183
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        bytes calldata /* optParams */
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

    /// @inheritdoc IERC8183
    function setProvider(uint256 jobId, address provider, bytes calldata /* optParams */) external override {
        Job storage job = jobs[jobId];
        if (job.client != msg.sender) revert NotClient();
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);
        if (job.provider != address(0)) revert ProviderAlreadySet();
        if (provider == address(0)) revert ZeroProvider();

        job.provider = provider;
        emit ProviderSet(jobId, provider);
    }

    /// @inheritdoc IERC8183
    function setBudget(uint256 jobId, uint256 amount, bytes calldata /* optParams */) external override {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);
        if (msg.sender != job.client && msg.sender != job.provider) revert NotClientOrProvider();

        job.budget = amount;
        emit BudgetSet(jobId, amount, msg.sender);
    }

    /// @inheritdoc IERC8183
    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata /* optParams */) external override nonReentrant {
        Job storage job = jobs[jobId];
        if (job.client != msg.sender) revert NotClient();
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);
        if (job.budget == 0) revert BudgetNotSet();
        if (job.provider == address(0)) revert ProviderNotSet();
        if (job.budget != expectedBudget) revert BudgetMismatch();

        USDC.safeTransferFrom(msg.sender, address(this), job.budget);
        job.status = JobStatus.Funded;

        emit JobFunded(jobId, job.budget);
    }

    /// @inheritdoc IERC8183
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata /* optParams */) external override nonReentrant {
        Job storage job = jobs[jobId];
        if (job.provider != msg.sender) revert NotProvider();
        if (job.status != JobStatus.Funded) revert InvalidStatus(job.status, JobStatus.Funded);

        job.deliverable = deliverable;
        job.status = JobStatus.Submitted;

        emit JobSubmitted(jobId, deliverable);
    }

    /// @inheritdoc IERC8183
    function complete(uint256 jobId, bytes32 reason, bytes calldata /* optParams */) external override nonReentrant {
        Job storage job = jobs[jobId];
        if (job.evaluator != msg.sender) revert NotEvaluator();
        if (job.status != JobStatus.Submitted) revert InvalidStatus(job.status, JobStatus.Submitted);

        job.status = JobStatus.Completed;

        // Distribute funds: provider gets budget minus fee
        uint256 fee = (job.budget * FEE_BPS) / 10_000;
        uint256 payout = job.budget - fee;

        if (fee > 0) USDC.safeTransfer(treasury, fee);
        if (payout > 0) USDC.safeTransfer(job.provider, payout);

        // Update registry reputation (best-effort — may fail if registry ownership not transferred)
        try registry.recordJobCompletion(job.provider, payout, 10) {} catch {}

        emit JobCompleted(jobId, reason);
    }

    /// @inheritdoc IERC8183
    function reject(uint256 jobId, bytes32 reason, bytes calldata /* optParams */) external override nonReentrant {
        Job storage job = jobs[jobId];

        if (job.status == JobStatus.Open) {
            // Only client can reject when Open
            if (msg.sender != job.client) revert NotClient();
        } else if (job.status == JobStatus.Funded || job.status == JobStatus.Submitted) {
            // Only evaluator can reject when Funded or Submitted
            if (msg.sender != job.evaluator) revert NotEvaluator();
            // Refund client
            if (job.budget > 0) {
                USDC.safeTransfer(job.client, job.budget);
            }
        } else {
            revert InvalidStatus(job.status, JobStatus.Open);
        }

        job.status = JobStatus.Rejected;
        emit JobRejected(jobId, reason, msg.sender);
    }

    /// @inheritdoc IERC8183
    function claimRefund(uint256 jobId) external override nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) {
            revert InvalidStatus(job.status, JobStatus.Funded);
        }
        if (block.timestamp < job.expiredAt) revert NotExpired();

        uint256 refund = job.budget;
        job.budget = 0;
        job.status = JobStatus.Expired;

        if (refund > 0) USDC.safeTransfer(job.client, refund);
        emit JobRefunded(jobId);
    }

    // ═══════════════════════════════════════════════════════════
    //  MARKETPLACE EXTENSIONS (bidding, compatibility)
    // ═══════════════════════════════════════════════════════════

    /// @notice Worker submits a bid on an open job.
    function bid(uint256 jobId, string calldata note) external {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);

        IGigaWorkRegistry.AgentProfile memory p = registry.getProfile(msg.sender);
        if (!p.isActive) revert AgentNotActive();

        bids[jobId].push(Bid({agent: msg.sender, proposedRate: p.hourlyRateUSDC, note: note, accepted: false}));
        emit BidSubmitted(jobId, msg.sender, p.hourlyRateUSDC);
    }

    /// @notice Client accepts a bid and sets the provider + budget.
    function acceptBid(uint256 jobId, address worker, uint256 budget) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.client != msg.sender) revert NotClient();
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);

        IGigaWorkRegistry.AgentProfile memory p = registry.getProfile(worker);
        if (!p.isActive) revert AgentNotActive();

        job.provider = worker;
        job.budget = budget;

        // Mark bid as accepted
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
