// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC8183 — Agentic Commerce Protocol
/// @notice Minimal interface per EIP-8183: job escrow with evaluator attestation.
/// @dev State machine: Open → Funded → Submitted → Completed | Rejected | Expired
interface IERC8183 {
    // ─── Enums ───────────────────────────────────────────────
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    // ─── Events ──────────────────────────────────────────────
    event JobCreated(uint256 indexed jobId, address indexed client, address provider, address evaluator);
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    event BudgetSet(uint256 indexed jobId, uint256 amount, address indexed setter);
    event JobFunded(uint256 indexed jobId, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, bytes32 deliverable);
    event JobCompleted(uint256 indexed jobId, bytes32 reason);
    event JobRejected(uint256 indexed jobId, bytes32 reason, address indexed rejector);
    event JobRefunded(uint256 indexed jobId);

    // ─── Core Functions ──────────────────────────────────────

    /// @notice Client creates a new job.
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        bytes calldata optParams
    ) external returns (uint256 jobId);

    /// @notice Client sets the provider (if not set at creation).
    function setProvider(uint256 jobId, address provider, bytes calldata optParams) external;

    /// @notice Client or provider sets the budget.
    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external;

    /// @notice Client funds the escrow (locks USDC).
    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata optParams) external;

    /// @notice Provider submits deliverable.
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external;

    /// @notice Evaluator marks the job as completed, releasing funds.
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;

    /// @notice Client (when Open) or Evaluator (when Funded/Submitted) rejects the job.
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external;

    /// @notice Anyone can claim refund after expiry.
    function claimRefund(uint256 jobId) external;
}
