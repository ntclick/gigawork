// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title GigaWorkStaking — Agent stake for trust & accountability
/// @notice Agents must stake USDC to register. Higher stake = higher trust tier.
///         Stake can be slashed on lost disputes. Withdrawal requires cooldown.
contract GigaWorkStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────
    IERC20 public constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    uint256 public constant MIN_STAKE         = 5_000_000;   // 5 USDC (6 decimals)
    uint256 public constant SILVER_THRESHOLD  = 25_000_000;  // 25 USDC
    uint256 public constant GOLD_THRESHOLD    = 100_000_000; // 100 USDC
    uint256 public constant SLASH_BPS         = 5000;        // 50% slash on lost dispute
    uint256 public constant COOLDOWN_PERIOD   = 7 days;

    // ─── Enums ───────────────────────────────────────────────
    enum Tier { NONE, BRONZE, SILVER, GOLD }
    enum StakeStatus { NONE, ACTIVE, COOLDOWN, WITHDRAWN }

    // ─── Structs ─────────────────────────────────────────────
    struct StakeInfo {
        uint256 amount;
        uint256 stakedAt;
        uint256 cooldownStartedAt;  // 0 if not in cooldown
        uint256 slashedTotal;
        StakeStatus status;
    }

    // ─── State ───────────────────────────────────────────────
    address public treasury;
    address public escrowContract;      // GigaWorkEscrow — can trigger slash

    mapping(address => StakeInfo) public stakes;
    address[] public allStakers;

    uint256 public totalStaked;
    uint256 public totalSlashed;

    // ─── Events ──────────────────────────────────────────────
    event Staked(address indexed agent, uint256 amount, Tier tier);
    event StakeIncreased(address indexed agent, uint256 newTotal, Tier newTier);
    event CooldownStarted(address indexed agent, uint256 unlockTime);
    event Withdrawn(address indexed agent, uint256 amount);
    event Slashed(address indexed agent, uint256 slashAmount, uint256 remaining);

    // ─── Errors ──────────────────────────────────────────────
    error InsufficientStake();
    error AlreadyStaked();
    error NotStaked();
    error NotInCooldown();
    error CooldownNotOver();
    error StillActive();
    error NotAuthorized();

    // ─── Constructor ─────────────────────────────────────────
    constructor(address _treasury, address _escrowContract) Ownable(msg.sender) {
        treasury = _treasury;
        escrowContract = _escrowContract;
    }

    // ─── Stake (first time) ──────────────────────────────────

    /// @notice Stake USDC to register as an agent. Must approve USDC first.
    function stake(uint256 amount) external nonReentrant {
        if (amount < MIN_STAKE) revert InsufficientStake();
        if (stakes[msg.sender].status == StakeStatus.ACTIVE) revert AlreadyStaked();

        USDC.safeTransferFrom(msg.sender, address(this), amount);

        stakes[msg.sender] = StakeInfo({
            amount: amount,
            stakedAt: block.timestamp,
            cooldownStartedAt: 0,
            slashedTotal: 0,
            status: StakeStatus.ACTIVE
        });

        // Track new staker
        if (stakes[msg.sender].stakedAt == block.timestamp) {
            allStakers.push(msg.sender);
        }

        totalStaked += amount;

        emit Staked(msg.sender, amount, getTier(msg.sender));
    }

    // ─── Increase Stake ──────────────────────────────────────

    /// @notice Add more USDC to increase trust tier.
    function increaseStake(uint256 additionalAmount) external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        if (s.status != StakeStatus.ACTIVE) revert NotStaked();

        USDC.safeTransferFrom(msg.sender, address(this), additionalAmount);
        s.amount += additionalAmount;
        totalStaked += additionalAmount;

        emit StakeIncreased(msg.sender, s.amount, getTier(msg.sender));
    }

    // ─── Start Cooldown (deactivate) ─────────────────────────

    /// @notice Start withdrawal cooldown. Agent becomes inactive after this.
    function startCooldown() external {
        StakeInfo storage s = stakes[msg.sender];
        if (s.status != StakeStatus.ACTIVE) revert NotStaked();

        s.status = StakeStatus.COOLDOWN;
        s.cooldownStartedAt = block.timestamp;

        emit CooldownStarted(msg.sender, block.timestamp + COOLDOWN_PERIOD);
    }

    // ─── Withdraw ────────────────────────────────────────────

    /// @notice Withdraw stake after cooldown period.
    function withdraw() external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        if (s.status != StakeStatus.COOLDOWN) revert NotInCooldown();
        if (block.timestamp < s.cooldownStartedAt + COOLDOWN_PERIOD) revert CooldownNotOver();

        uint256 amount = s.amount;
        s.amount = 0;
        s.status = StakeStatus.WITHDRAWN;
        totalStaked -= amount;

        USDC.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // ─── Slash (called by escrow on lost dispute) ────────────

    /// @notice Slash agent's stake. Only callable by escrow contract or owner.
    function slash(address agent) external nonReentrant {
        if (msg.sender != escrowContract && msg.sender != owner()) revert NotAuthorized();

        StakeInfo storage s = stakes[agent];
        if (s.status == StakeStatus.NONE || s.status == StakeStatus.WITHDRAWN) revert NotStaked();

        uint256 slashAmount = (s.amount * SLASH_BPS) / 10_000;
        s.amount -= slashAmount;
        s.slashedTotal += slashAmount;
        totalStaked -= slashAmount;
        totalSlashed += slashAmount;

        // Send slashed amount to treasury
        USDC.safeTransfer(treasury, slashAmount);

        emit Slashed(agent, slashAmount, s.amount);

        // If remaining stake below minimum, force deactivate
        if (s.amount < MIN_STAKE && s.status == StakeStatus.ACTIVE) {
            s.status = StakeStatus.COOLDOWN;
            s.cooldownStartedAt = block.timestamp;
        }
    }

    // ─── Views ───────────────────────────────────────────────

    function getTier(address agent) public view returns (Tier) {
        uint256 amount = stakes[agent].amount;
        if (amount >= GOLD_THRESHOLD) return Tier.GOLD;
        if (amount >= SILVER_THRESHOLD) return Tier.SILVER;
        if (amount >= MIN_STAKE) return Tier.BRONZE;
        return Tier.NONE;
    }

    function getStake(address agent) external view returns (StakeInfo memory) {
        return stakes[agent];
    }

    function isStaked(address agent) external view returns (bool) {
        return stakes[agent].status == StakeStatus.ACTIVE;
    }

    function totalStakers() external view returns (uint256) {
        return allStakers.length;
    }

    // ─── Admin ───────────────────────────────────────────────

    function setEscrowContract(address _escrow) external onlyOwner {
        escrowContract = _escrow;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }
}
