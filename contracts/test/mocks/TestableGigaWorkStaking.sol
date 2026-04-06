// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Testable version of GigaWorkStaking that accepts custom USDC address
contract TestableGigaWorkStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public usdc;

    uint256 public constant MIN_STAKE         = 5_000_000;
    uint256 public constant SILVER_THRESHOLD  = 25_000_000;
    uint256 public constant GOLD_THRESHOLD    = 100_000_000;
    uint256 public constant SLASH_BPS         = 5000;
    uint256 public constant COOLDOWN_PERIOD   = 7 days;

    enum Tier { NONE, BRONZE, SILVER, GOLD }
    enum StakeStatus { NONE, ACTIVE, COOLDOWN, WITHDRAWN }

    struct StakeInfo {
        uint256 amount;
        uint256 stakedAt;
        uint256 cooldownStartedAt;
        uint256 slashedTotal;
        StakeStatus status;
    }

    address public treasury;
    address public escrowContract;

    mapping(address => StakeInfo) public stakes;
    address[] public allStakers;

    uint256 public totalStaked;
    uint256 public totalSlashed;

    event Staked(address indexed agent, uint256 amount, Tier tier);
    event StakeIncreased(address indexed agent, uint256 newTotal, Tier newTier);
    event CooldownStarted(address indexed agent, uint256 unlockTime);
    event Withdrawn(address indexed agent, uint256 amount);
    event Slashed(address indexed agent, uint256 slashAmount, uint256 remaining);

    error InsufficientStake();
    error AlreadyStaked();
    error NotStaked();
    error NotInCooldown();
    error CooldownNotOver();
    error StillActive();
    error NotAuthorized();

    constructor(address _usdc, address _treasury, address _escrowContract) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        treasury = _treasury;
        escrowContract = _escrowContract;
    }

    function stake(uint256 amount) external nonReentrant {
        if (amount < MIN_STAKE) revert InsufficientStake();
        if (stakes[msg.sender].status == StakeStatus.ACTIVE) revert AlreadyStaked();

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        stakes[msg.sender] = StakeInfo({
            amount: amount,
            stakedAt: block.timestamp,
            cooldownStartedAt: 0,
            slashedTotal: 0,
            status: StakeStatus.ACTIVE
        });

        if (stakes[msg.sender].stakedAt == block.timestamp) {
            allStakers.push(msg.sender);
        }

        totalStaked += amount;
        emit Staked(msg.sender, amount, getTier(msg.sender));
    }

    function increaseStake(uint256 additionalAmount) external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        if (s.status != StakeStatus.ACTIVE) revert NotStaked();

        usdc.safeTransferFrom(msg.sender, address(this), additionalAmount);
        s.amount += additionalAmount;
        totalStaked += additionalAmount;

        emit StakeIncreased(msg.sender, s.amount, getTier(msg.sender));
    }

    function startCooldown() external {
        StakeInfo storage s = stakes[msg.sender];
        if (s.status != StakeStatus.ACTIVE) revert NotStaked();

        s.status = StakeStatus.COOLDOWN;
        s.cooldownStartedAt = block.timestamp;

        emit CooldownStarted(msg.sender, block.timestamp + COOLDOWN_PERIOD);
    }

    function withdraw() external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        if (s.status != StakeStatus.COOLDOWN) revert NotInCooldown();
        if (block.timestamp < s.cooldownStartedAt + COOLDOWN_PERIOD) revert CooldownNotOver();

        uint256 amount = s.amount;
        s.amount = 0;
        s.status = StakeStatus.WITHDRAWN;
        totalStaked -= amount;

        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function slash(address agent) external nonReentrant {
        if (msg.sender != escrowContract && msg.sender != owner()) revert NotAuthorized();

        StakeInfo storage s = stakes[agent];
        if (s.status == StakeStatus.NONE || s.status == StakeStatus.WITHDRAWN) revert NotStaked();

        uint256 slashAmount = (s.amount * SLASH_BPS) / 10_000;
        s.amount -= slashAmount;
        s.slashedTotal += slashAmount;
        totalStaked -= slashAmount;
        totalSlashed += slashAmount;

        usdc.safeTransfer(treasury, slashAmount);
        emit Slashed(agent, slashAmount, s.amount);

        if (s.amount < MIN_STAKE && s.status == StakeStatus.ACTIVE) {
            s.status = StakeStatus.COOLDOWN;
            s.cooldownStartedAt = block.timestamp;
        }
    }

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

    function setEscrowContract(address _escrow) external onlyOwner {
        escrowContract = _escrow;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }
}
