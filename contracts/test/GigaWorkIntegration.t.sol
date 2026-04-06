// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./mocks/MockIdentityRegistry.sol";
import "./mocks/MockUSDC.sol";
import "./mocks/TestableGigaWorkRegistry.sol";
import "./mocks/TestableGigaWorkCommerce.sol";
import "./mocks/TestableGigaWorkStaking.sol";
import "../src/interfaces/IERC8183.sol";

contract GigaWorkIntegrationTest is Test {
    MockIdentityRegistry identityRegistry;
    MockUSDC usdc;
    TestableGigaWorkRegistry registry;
    TestableGigaWorkCommerce commerce;
    TestableGigaWorkStaking staking;

    address client = makeAddr("client");
    address agentA = makeAddr("agentA");
    address agentB = makeAddr("agentB");
    address evaluator = makeAddr("evaluator");
    address treasury = makeAddr("treasury");

    uint256 agentATokenId;
    uint256 agentBTokenId;

    uint256 constant RATE = 10_000_000;       // 10 USDC
    uint256 constant BUDGET_50 = 50_000_000;  // 50 USDC
    uint256 constant BUDGET_100 = 100_000_000;

    function setUp() public {
        identityRegistry = new MockIdentityRegistry();
        usdc = new MockUSDC();

        registry = new TestableGigaWorkRegistry(address(identityRegistry));
        staking = new TestableGigaWorkStaking(address(usdc), treasury, address(0));
        commerce = new TestableGigaWorkCommerce(address(usdc), address(registry), treasury);

        // Transfer registry ownership to commerce so recordJobCompletion works
        registry.transferOwnership(address(commerce));

        // Mint ERC-8004 identity tokens
        vm.prank(agentA);
        agentATokenId = identityRegistry.mint(agentA);

        vm.prank(agentB);
        agentBTokenId = identityRegistry.mint(agentB);

        // Fund everyone with USDC
        usdc.mint(client, 10_000_000_000);   // 10,000 USDC
        usdc.mint(agentA, 500_000_000);      // 500 USDC
        usdc.mint(agentB, 500_000_000);
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════

    function _registerAgent(address agent, uint256 tokenId) internal {
        string[] memory tags = new string[](1);
        tags[0] = "research";
        vm.prank(agent);
        registry.register(tokenId, RATE, tags);
    }

    /// @dev Creates job, sets budget, funds, submits, completes — full cycle
    function _completeJob(address provider, uint256 budget) internal returns (uint256 jobId) {
        // Client creates job
        vm.prank(client);
        jobId = commerce.createJob(
            provider,
            evaluator,
            block.timestamp + 1 hours,
            "integration test job",
            ""
        );

        // Provider sets budget
        vm.prank(provider);
        commerce.setBudget(jobId, budget, "");

        // Client funds
        vm.startPrank(client);
        usdc.approve(address(commerce), budget);
        commerce.fund(jobId, budget, "");
        vm.stopPrank();

        // Provider submits
        vm.prank(provider);
        commerce.submit(jobId, keccak256("deliverable"), "");

        // Evaluator completes
        vm.prank(evaluator);
        commerce.complete(jobId, keccak256("approved"), "");
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 1: Register then complete a job
    // ═══════════════════════════════════════════════════════════

    function test_Integration_RegisterThenWork() public {
        _registerAgent(agentA, agentATokenId);

        // Verify initial state
        TestableGigaWorkRegistry.AgentProfile memory before = registry.getProfile(agentA);
        assertEq(before.reputationScore, 500);
        assertEq(before.totalJobsDone, 0);
        assertEq(before.totalEarnedUSDC, 0);

        // Complete a job
        _completeJob(agentA, BUDGET_50);

        // Verify post-job state
        TestableGigaWorkRegistry.AgentProfile memory postWork = registry.getProfile(agentA);
        assertEq(postWork.reputationScore, 510); // 500 + 10 (hardcoded in Commerce.complete)
        assertEq(postWork.totalJobsDone, 1);
        // payout = 50_000_000 * 95% = 47_500_000
        assertEq(postWork.totalEarnedUSDC, 47_500_000);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 2: Stake then register then work
    // ═══════════════════════════════════════════════════════════

    function test_Integration_StakeThenRegister() public {
        // Agent stakes 25 USDC (SILVER)
        vm.startPrank(agentA);
        usdc.approve(address(staking), 25_000_000);
        staking.stake(25_000_000);
        vm.stopPrank();

        assertEq(uint8(staking.getTier(agentA)), uint8(TestableGigaWorkStaking.Tier.SILVER));

        // Register in registry
        _registerAgent(agentA, agentATokenId);

        // Complete a job
        _completeJob(agentA, BUDGET_50);

        // Verify reputation updated
        TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(agentA);
        assertEq(p.reputationScore, 510);
        assertEq(p.totalJobsDone, 1);

        // Staking balance should be unchanged (jobs don't affect stake)
        TestableGigaWorkStaking.StakeInfo memory s = staking.getStake(agentA);
        assertEq(s.amount, 25_000_000);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 3: Slash after bad behavior
    // ═══════════════════════════════════════════════════════════

    function test_Integration_SlashAfterBadJob() public {
        _registerAgent(agentA, agentATokenId);

        // Stake 20 USDC
        vm.startPrank(agentA);
        usdc.approve(address(staking), 20_000_000);
        staking.stake(20_000_000);
        vm.stopPrank();

        // Complete a job — reputation goes up
        _completeJob(agentA, BUDGET_50);

        TestableGigaWorkRegistry.AgentProfile memory postJob = registry.getProfile(agentA);
        assertEq(postJob.reputationScore, 510);

        // Owner slashes agent (bad behavior outside job system)
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        staking.slash(agentA);

        // Stake reduced 50%: 20 → 10
        TestableGigaWorkStaking.StakeInfo memory s = staking.getStake(agentA);
        assertEq(s.amount, 10_000_000);
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 10_000_000);

        // Reputation NOT affected by slash (slash is financial only)
        TestableGigaWorkRegistry.AgentProfile memory postSlash = registry.getProfile(agentA);
        assertEq(postSlash.reputationScore, 510); // unchanged
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 4: Multiple jobs accumulate reputation
    // ═══════════════════════════════════════════════════════════

    function test_Integration_MultipleJobsReputation() public {
        _registerAgent(agentA, agentATokenId);

        // Complete 3 jobs (each gives +10 reputation via Commerce.complete)
        _completeJob(agentA, BUDGET_50);
        _completeJob(agentA, BUDGET_50);
        _completeJob(agentA, BUDGET_50);

        TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(agentA);
        assertEq(p.reputationScore, 530); // 500 + 10 + 10 + 10
        assertEq(p.totalJobsDone, 3);

        // Earnings = 3 * (50 * 0.95) = 3 * 47_500_000 = 142_500_000
        assertEq(p.totalEarnedUSDC, 142_500_000);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 5: Reputation clamped at 1000
    // ═══════════════════════════════════════════════════════════

    function test_Integration_ReputationClampMax() public {
        _registerAgent(agentA, agentATokenId);

        // Need 50 more jobs at +10 each to go from 500 to 1000
        // Do 55 jobs to try to exceed
        for (uint256 i = 0; i < 55; i++) {
            _completeJob(agentA, 1_000_000); // 1 USDC each (small to save gas)
        }

        TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(agentA);
        assertEq(p.reputationScore, 1000); // clamped, not 1050
        assertEq(p.totalJobsDone, 55);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 6: Reputation clamped at 0
    // ═══════════════════════════════════════════════════════════

    function test_Integration_ReputationClampMin() public {
        _registerAgent(agentA, agentATokenId);

        // Commerce.complete always uses scoreDelta = +10
        // To test negative, we call recordJobCompletion directly (as owner = commerce)
        // Simulate: agent gets -100 reputation per bad job
        // Need to call from commerce address since registry.owner == commerce

        // First, verify initial reputation
        assertEq(registry.getProfile(agentA).reputationScore, 500);

        // Call recordJobCompletion with negative scoreDelta from commerce (the owner)
        vm.prank(address(commerce));
        registry.recordJobCompletion(agentA, 0, -200);
        assertEq(registry.getProfile(agentA).reputationScore, 300);

        vm.prank(address(commerce));
        registry.recordJobCompletion(agentA, 0, -200);
        assertEq(registry.getProfile(agentA).reputationScore, 100);

        // This should clamp to 0, not go to -100
        vm.prank(address(commerce));
        registry.recordJobCompletion(agentA, 0, -200);
        assertEq(registry.getProfile(agentA).reputationScore, 0);

        // And stay at 0
        vm.prank(address(commerce));
        registry.recordJobCompletion(agentA, 0, -100);
        assertEq(registry.getProfile(agentA).reputationScore, 0);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 7: Full platform flow with two competing agents
    // ═══════════════════════════════════════════════════════════

    function test_Integration_FullPlatformFlow() public {
        // 1. Register both agents
        _registerAgent(agentA, agentATokenId);
        _registerAgent(agentB, agentBTokenId);

        // 2. Agent A stakes GOLD (100 USDC)
        vm.startPrank(agentA);
        usdc.approve(address(staking), 100_000_000);
        staking.stake(100_000_000);
        vm.stopPrank();
        assertEq(uint8(staking.getTier(agentA)), uint8(TestableGigaWorkStaking.Tier.GOLD));

        // 3. Agent B stakes BRONZE (5 USDC)
        vm.startPrank(agentB);
        usdc.approve(address(staking), 5_000_000);
        staking.stake(5_000_000);
        vm.stopPrank();
        assertEq(uint8(staking.getTier(agentB)), uint8(TestableGigaWorkStaking.Tier.BRONZE));

        // 4. Client creates job, Agent A bids via marketplace flow
        vm.prank(client);
        uint256 job1 = commerce.createJob(
            address(0), // open market
            evaluator,
            block.timestamp + 2 hours,
            "research task",
            ""
        );

        // Agent A bids
        vm.prank(agentA);
        commerce.bid(job1, "I can deliver");

        // Client accepts Agent A's bid with 100 USDC budget
        vm.prank(client);
        commerce.acceptBid(job1, agentA, BUDGET_100);

        // Fund, submit, complete
        vm.startPrank(client);
        usdc.approve(address(commerce), BUDGET_100);
        commerce.fund(job1, BUDGET_100, "");
        vm.stopPrank();

        vm.prank(agentA);
        commerce.submit(job1, keccak256("agent A result"), "");

        uint256 agentABalBefore = usdc.balanceOf(agentA);
        uint256 treasuryBalBefore = usdc.balanceOf(treasury);

        vm.prank(evaluator);
        commerce.complete(job1, keccak256("good work"), "");

        // 5. Assert Agent A got paid
        uint256 agentAPayout = usdc.balanceOf(agentA) - agentABalBefore;
        uint256 treasuryFee = usdc.balanceOf(treasury) - treasuryBalBefore;
        assertEq(agentAPayout, 95_000_000);  // 95% of 100
        assertEq(treasuryFee, 5_000_000);    // 5% fee

        // 6. Client creates second job, Agent B bids
        vm.prank(client);
        uint256 job2 = commerce.createJob(
            address(0),
            evaluator,
            block.timestamp + 2 hours,
            "another task",
            ""
        );

        vm.prank(agentB);
        commerce.bid(job2, "I'll try");

        vm.prank(client);
        commerce.acceptBid(job2, agentB, BUDGET_50);

        vm.startPrank(client);
        usdc.approve(address(commerce), BUDGET_50);
        commerce.fund(job2, BUDGET_50, "");
        vm.stopPrank();

        vm.prank(agentB);
        commerce.submit(job2, keccak256("agent B result"), "");

        // 7. Evaluator rejects Agent B's work
        uint256 clientBalBefore = usdc.balanceOf(client);
        vm.prank(evaluator);
        commerce.reject(job2, keccak256("poor quality"), "");

        // Budget refunded to client
        assertEq(usdc.balanceOf(client) - clientBalBefore, BUDGET_50);

        // 8. Agent A reputation > Agent B reputation
        uint256 repA = registry.getProfile(agentA).reputationScore;
        uint256 repB = registry.getProfile(agentB).reputationScore;
        assertEq(repA, 510); // 500 + 10 from completed job
        assertEq(repB, 500); // unchanged — rejection doesn't affect reputation

        // 9. Agent A earned USDC, Agent B earned nothing
        assertEq(registry.getProfile(agentA).totalEarnedUSDC, 95_000_000);
        assertEq(registry.getProfile(agentB).totalEarnedUSDC, 0);

        // 10. Treasury received fees from Agent A's job only
        assertGt(usdc.balanceOf(treasury), 0);

        // 11. Agent B stake unchanged (rejection ≠ slash)
        TestableGigaWorkStaking.StakeInfo memory sB = staking.getStake(agentB);
        assertEq(sB.amount, 5_000_000); // untouched
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 8: Ownership chain verification
    // ═══════════════════════════════════════════════════════════

    function test_Integration_OwnershipChain() public {
        // Registry should be owned by Commerce
        assertEq(registry.owner(), address(commerce));

        _registerAgent(agentA, agentATokenId);

        // Commerce can call recordJobCompletion (indirectly via complete)
        _completeJob(agentA, BUDGET_50);
        assertEq(registry.getProfile(agentA).totalJobsDone, 1); // proves it worked

        // Direct call from test address (not owner) should revert
        vm.expectRevert();
        registry.recordJobCompletion(agentA, 1000, 10);

        // Direct call from a random address should also revert
        vm.prank(client);
        vm.expectRevert();
        registry.recordJobCompletion(agentA, 1000, 10);
    }
}
