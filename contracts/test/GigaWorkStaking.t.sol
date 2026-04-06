// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./mocks/MockUSDC.sol";
import "./mocks/TestableGigaWorkStaking.sol";

contract GigaWorkStakingTest is Test {
    MockUSDC usdc;
    TestableGigaWorkStaking staking;

    address agent1 = makeAddr("agent1");
    address agent2 = makeAddr("agent2");
    address treasury = makeAddr("treasury");
    address escrow = makeAddr("escrow");
    address randomUser = makeAddr("randomUser");

    uint256 constant MIN       = 5_000_000;   // 5 USDC
    uint256 constant SILVER    = 25_000_000;   // 25 USDC
    uint256 constant GOLD      = 100_000_000;  // 100 USDC

    function setUp() public {
        usdc = new MockUSDC();
        staking = new TestableGigaWorkStaking(address(usdc), treasury, escrow);

        // Fund agents
        usdc.mint(agent1, 500_000_000); // 500 USDC
        usdc.mint(agent2, 500_000_000);
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════

    function _stake(address agent, uint256 amount) internal {
        vm.startPrank(agent);
        usdc.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 1: STAKE (BRONZE)
    // ═══════════════════════════════════════════════════════════

    function test_Staking_Stake() public {
        uint256 amount = 10_000_000; // 10 USDC

        uint256 balBefore = usdc.balanceOf(agent1);

        _stake(agent1, amount);

        TestableGigaWorkStaking.StakeInfo memory s = staking.getStake(agent1);
        assertEq(s.amount, amount);
        assertEq(uint8(s.status), uint8(TestableGigaWorkStaking.StakeStatus.ACTIVE));
        assertGt(s.stakedAt, 0);
        assertEq(s.cooldownStartedAt, 0);
        assertEq(s.slashedTotal, 0);

        assertEq(uint8(staking.getTier(agent1)), uint8(TestableGigaWorkStaking.Tier.BRONZE));
        assertEq(usdc.balanceOf(agent1), balBefore - amount);
        assertEq(usdc.balanceOf(address(staking)), amount);
        assertEq(staking.totalStaked(), amount);
        assertEq(staking.totalStakers(), 1);
        assertTrue(staking.isStaked(agent1));
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 2: STAKE SILVER
    // ═══════════════════════════════════════════════════════════

    function test_Staking_StakeSilver() public {
        _stake(agent1, SILVER);

        assertEq(uint8(staking.getTier(agent1)), uint8(TestableGigaWorkStaking.Tier.SILVER));
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 3: STAKE GOLD
    // ═══════════════════════════════════════════════════════════

    function test_Staking_StakeGold() public {
        _stake(agent1, GOLD);

        assertEq(uint8(staking.getTier(agent1)), uint8(TestableGigaWorkStaking.Tier.GOLD));
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 4: REVERT BELOW MINIMUM
    // ═══════════════════════════════════════════════════════════

    function test_Staking_RevertBelowMinimum() public {
        vm.startPrank(agent1);
        usdc.approve(address(staking), 4_000_000);

        vm.expectRevert(TestableGigaWorkStaking.InsufficientStake.selector);
        staking.stake(4_000_000); // 4 USDC < 5 USDC min

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 5: START COOLDOWN
    // ═══════════════════════════════════════════════════════════

    function test_Staking_StartCooldown() public {
        _stake(agent1, 10_000_000);

        vm.prank(agent1);
        staking.startCooldown();

        TestableGigaWorkStaking.StakeInfo memory s = staking.getStake(agent1);
        assertEq(uint8(s.status), uint8(TestableGigaWorkStaking.StakeStatus.COOLDOWN));
        assertGt(s.cooldownStartedAt, 0);
        assertFalse(staking.isStaked(agent1));
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 6: WITHDRAW AFTER COOLDOWN
    // ═══════════════════════════════════════════════════════════

    function test_Staking_Withdraw() public {
        uint256 amount = 10_000_000;
        _stake(agent1, amount);

        vm.prank(agent1);
        staking.startCooldown();

        // Warp past 7 days
        vm.warp(block.timestamp + 7 days + 1);

        uint256 balBefore = usdc.balanceOf(agent1);

        vm.prank(agent1);
        staking.withdraw();

        TestableGigaWorkStaking.StakeInfo memory s = staking.getStake(agent1);
        assertEq(uint8(s.status), uint8(TestableGigaWorkStaking.StakeStatus.WITHDRAWN));
        assertEq(s.amount, 0);
        assertEq(usdc.balanceOf(agent1), balBefore + amount);
        assertEq(usdc.balanceOf(address(staking)), 0);
        assertEq(staking.totalStaked(), 0);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 7: REVERT WITHDRAW TOO EARLY
    // ═══════════════════════════════════════════════════════════

    function test_Staking_RevertWithdrawTooEarly() public {
        _stake(agent1, 10_000_000);

        vm.prank(agent1);
        staking.startCooldown();

        // Only 6 days passed
        vm.warp(block.timestamp + 6 days);

        vm.prank(agent1);
        vm.expectRevert(TestableGigaWorkStaking.CooldownNotOver.selector);
        staking.withdraw();
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 8: REVERT WITHDRAW NOT IN COOLDOWN
    // ═══════════════════════════════════════════════════════════

    function test_Staking_RevertWithdrawNotInCooldown() public {
        _stake(agent1, 10_000_000);

        // Still ACTIVE, no cooldown started
        vm.prank(agent1);
        vm.expectRevert(TestableGigaWorkStaking.NotInCooldown.selector);
        staking.withdraw();
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 9: SLASH
    // ═══════════════════════════════════════════════════════════

    function test_Staking_Slash() public {
        uint256 amount = 20_000_000; // 20 USDC
        _stake(agent1, amount);

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        // Owner slashes
        staking.slash(agent1);

        // 50% of 20 USDC = 10 USDC slashed
        TestableGigaWorkStaking.StakeInfo memory s = staking.getStake(agent1);
        assertEq(s.amount, 10_000_000);          // 10 USDC remaining
        assertEq(s.slashedTotal, 10_000_000);     // 10 USDC slashed total
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 10_000_000);
        assertEq(staking.totalSlashed(), 10_000_000);
        assertEq(staking.totalStaked(), 10_000_000);

        // Still ACTIVE since remaining (10) >= MIN_STAKE (5)
        assertEq(uint8(s.status), uint8(TestableGigaWorkStaking.StakeStatus.ACTIVE));
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 10: SLASH FORCES COOLDOWN
    // ═══════════════════════════════════════════════════════════

    function test_Staking_SlashForceCooldown() public {
        uint256 amount = 8_000_000; // 8 USDC (barely above 5 min)
        _stake(agent1, amount);

        staking.slash(agent1);

        // 50% of 8 = 4 USDC slashed, 4 remaining
        TestableGigaWorkStaking.StakeInfo memory s = staking.getStake(agent1);
        assertEq(s.amount, 4_000_000);   // 4 USDC remaining
        assertLt(s.amount, MIN);          // below MIN_STAKE

        // Should be forced into COOLDOWN
        assertEq(uint8(s.status), uint8(TestableGigaWorkStaking.StakeStatus.COOLDOWN));
        assertGt(s.cooldownStartedAt, 0);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 11: REVERT SLASH NOT AUTHORIZED
    // ═══════════════════════════════════════════════════════════

    function test_Staking_RevertSlashNotOwner() public {
        _stake(agent1, 20_000_000);

        vm.prank(randomUser);
        vm.expectRevert(TestableGigaWorkStaking.NotAuthorized.selector);
        staking.slash(agent1);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 12: INCREASE STAKE
    // ═══════════════════════════════════════════════════════════

    function test_Staking_AddStake() public {
        _stake(agent1, 10_000_000); // 10 USDC = BRONZE
        assertEq(uint8(staking.getTier(agent1)), uint8(TestableGigaWorkStaking.Tier.BRONZE));

        // Add 15 USDC → total 25 USDC = SILVER
        vm.startPrank(agent1);
        usdc.approve(address(staking), 15_000_000);
        staking.increaseStake(15_000_000);
        vm.stopPrank();

        TestableGigaWorkStaking.StakeInfo memory s = staking.getStake(agent1);
        assertEq(s.amount, 25_000_000);
        assertEq(uint8(staking.getTier(agent1)), uint8(TestableGigaWorkStaking.Tier.SILVER));
        assertEq(staking.totalStaked(), 25_000_000);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 13: GET TIER BOUNDARIES
    // ═══════════════════════════════════════════════════════════

    function test_Staking_GetTier() public {
        // No stake → NONE
        assertEq(uint8(staking.getTier(agent2)), uint8(TestableGigaWorkStaking.Tier.NONE));

        // Stake exactly MIN → BRONZE
        _stake(agent1, MIN);
        assertEq(uint8(staking.getTier(agent1)), uint8(TestableGigaWorkStaking.Tier.BRONZE));

        // Increase to exactly SILVER
        vm.startPrank(agent1);
        usdc.approve(address(staking), SILVER - MIN);
        staking.increaseStake(SILVER - MIN);
        vm.stopPrank();
        assertEq(uint8(staking.getTier(agent1)), uint8(TestableGigaWorkStaking.Tier.SILVER));

        // Increase to exactly GOLD
        vm.startPrank(agent1);
        usdc.approve(address(staking), GOLD - SILVER);
        staking.increaseStake(GOLD - SILVER);
        vm.stopPrank();
        assertEq(uint8(staking.getTier(agent1)), uint8(TestableGigaWorkStaking.Tier.GOLD));
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 14: REVERT DOUBLE WITHDRAW
    // ═══════════════════════════════════════════════════════════

    function test_Staking_RevertDoubleWithdraw() public {
        _stake(agent1, 10_000_000);

        vm.prank(agent1);
        staking.startCooldown();

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(agent1);
        staking.withdraw();

        // Second withdraw should revert — status is WITHDRAWN, not COOLDOWN
        vm.prank(agent1);
        vm.expectRevert(TestableGigaWorkStaking.NotInCooldown.selector);
        staking.withdraw();
    }
}
