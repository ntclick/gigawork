// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./mocks/MockIdentityRegistry.sol";
import "./mocks/MockUSDC.sol";
import "./mocks/TestableGigaWorkRegistry.sol";
import "./mocks/TestableGigaWorkCommerce.sol";
import "../src/interfaces/IERC8183.sol";

contract GigaWorkCommerceTest is Test {
    MockIdentityRegistry identityRegistry;
    MockUSDC usdc;
    TestableGigaWorkRegistry registry;
    TestableGigaWorkCommerce commerce;

    address client = makeAddr("client");
    address provider = makeAddr("provider");
    address evaluator = makeAddr("evaluator");
    address treasury = makeAddr("treasury");
    address randomUser = makeAddr("randomUser");

    uint256 providerTokenId;

    uint256 constant BUDGET_100 = 100_000_000; // 100 USDC
    uint256 constant BUDGET_5 = 5_000_000;     // 5 USDC
    uint256 constant RATE_10 = 10_000_000;     // 10 USDC/hr

    function setUp() public {
        // Deploy mocks
        identityRegistry = new MockIdentityRegistry();
        usdc = new MockUSDC();

        // Deploy testable contracts
        registry = new TestableGigaWorkRegistry(address(identityRegistry));
        commerce = new TestableGigaWorkCommerce(address(usdc), address(registry), treasury);

        // Transfer registry ownership to commerce (so recordJobCompletion works)
        registry.transferOwnership(address(commerce));

        // Register provider as agent
        vm.prank(provider);
        providerTokenId = identityRegistry.mint(provider);

        string[] memory tags = new string[](2);
        tags[0] = "research";
        tags[1] = "analysis";

        vm.prank(provider);
        registry.register(providerTokenId, RATE_10, tags);

        // Fund client with USDC
        usdc.mint(client, 1_000_000_000); // 1000 USDC
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════

    function _createJob() internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = commerce.createJob(
            provider,
            evaluator,
            block.timestamp + 1 hours,
            "test task",
            ""
        );
    }

    function _createAndBudget() internal returns (uint256 jobId) {
        jobId = _createJob();
        vm.prank(provider);
        commerce.setBudget(jobId, BUDGET_100, "");
    }

    function _createBudgetAndFund() internal returns (uint256 jobId) {
        jobId = _createAndBudget();
        vm.startPrank(client);
        usdc.approve(address(commerce), BUDGET_100);
        commerce.fund(jobId, BUDGET_100, "");
        vm.stopPrank();
    }

    function _createBudgetFundAndSubmit() internal returns (uint256 jobId) {
        jobId = _createBudgetAndFund();
        vm.prank(provider);
        commerce.submit(jobId, keccak256("deliverable data"), "");
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 1: CREATE JOB
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_CreateJob() public {
        vm.prank(client);
        uint256 jobId = commerce.createJob(
            provider,
            evaluator,
            block.timestamp + 1 hours,
            "research task",
            ""
        );

        TestableGigaWorkCommerce.Job memory job = commerce.getJob(jobId);
        assertEq(job.client, client);
        assertEq(job.provider, provider);
        assertEq(job.evaluator, evaluator);
        assertEq(uint8(job.status), uint8(IERC8183.JobStatus.Open));
        assertEq(job.budget, 0);
        assertEq(commerce.totalJobs(), 1);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 2: SET BUDGET
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_SetBudget() public {
        uint256 jobId = _createJob();

        vm.prank(provider);
        commerce.setBudget(jobId, BUDGET_5, "");

        TestableGigaWorkCommerce.Job memory job = commerce.getJob(jobId);
        assertEq(job.budget, BUDGET_5);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 3: FUND
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_Fund() public {
        uint256 jobId = _createAndBudget();

        uint256 clientBalBefore = usdc.balanceOf(client);
        uint256 contractBalBefore = usdc.balanceOf(address(commerce));

        vm.startPrank(client);
        usdc.approve(address(commerce), BUDGET_100);
        commerce.fund(jobId, BUDGET_100, "");
        vm.stopPrank();

        TestableGigaWorkCommerce.Job memory job = commerce.getJob(jobId);
        assertEq(uint8(job.status), uint8(IERC8183.JobStatus.Funded));
        assertEq(usdc.balanceOf(client), clientBalBefore - BUDGET_100);
        assertEq(usdc.balanceOf(address(commerce)), contractBalBefore + BUDGET_100);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 4: SUBMIT
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_Submit() public {
        uint256 jobId = _createBudgetAndFund();

        bytes32 deliverable = keccak256("deliverable hash");

        vm.prank(provider);
        commerce.submit(jobId, deliverable, "");

        TestableGigaWorkCommerce.Job memory job = commerce.getJob(jobId);
        assertEq(uint8(job.status), uint8(IERC8183.JobStatus.Submitted));
        assertEq(job.deliverable, deliverable);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 5: COMPLETE (full payout verification)
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_Complete() public {
        uint256 jobId = _createBudgetFundAndSubmit();

        uint256 providerBalBefore = usdc.balanceOf(provider);
        uint256 treasuryBalBefore = usdc.balanceOf(treasury);

        vm.prank(evaluator);
        commerce.complete(jobId, keccak256("approved"), "");

        TestableGigaWorkCommerce.Job memory job = commerce.getJob(jobId);
        assertEq(uint8(job.status), uint8(IERC8183.JobStatus.Completed));

        // fee = 100_000_000 * 500 / 10000 = 5_000_000 (5 USDC)
        // payout = 100_000_000 - 5_000_000 = 95_000_000 (95 USDC)
        assertEq(usdc.balanceOf(provider) - providerBalBefore, 95_000_000);
        assertEq(usdc.balanceOf(treasury) - treasuryBalBefore, 5_000_000);

        // Contract should have zero balance after complete
        assertEq(usdc.balanceOf(address(commerce)), 0);

        // Registry reputation should be updated
        TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(provider);
        assertEq(p.totalJobsDone, 1);
        assertEq(p.totalEarnedUSDC, 95_000_000);
        assertEq(p.reputationScore, 510); // 500 + 10
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 6: REJECT (refund)
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_Reject() public {
        uint256 jobId = _createBudgetAndFund();

        uint256 clientBalBefore = usdc.balanceOf(client);

        // Evaluator rejects funded job
        vm.prank(evaluator);
        commerce.reject(jobId, keccak256("not acceptable"), "");

        TestableGigaWorkCommerce.Job memory job = commerce.getJob(jobId);
        assertEq(uint8(job.status), uint8(IERC8183.JobStatus.Rejected));

        // Full budget refunded to client
        assertEq(usdc.balanceOf(client) - clientBalBefore, BUDGET_100);
        assertEq(usdc.balanceOf(address(commerce)), 0);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 7: CLAIM REFUND (expired)
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_ClaimRefund() public {
        uint256 jobId = _createBudgetAndFund();

        uint256 clientBalBefore = usdc.balanceOf(client);

        // Try too early — should revert
        vm.prank(client);
        vm.expectRevert(TestableGigaWorkCommerce.NotExpired.selector);
        commerce.claimRefund(jobId);

        // Warp past expiry
        vm.warp(block.timestamp + 2 hours);

        vm.prank(client);
        commerce.claimRefund(jobId);

        TestableGigaWorkCommerce.Job memory job = commerce.getJob(jobId);
        assertEq(uint8(job.status), uint8(IERC8183.JobStatus.Expired));
        assertEq(usdc.balanceOf(client) - clientBalBefore, BUDGET_100);
        assertEq(usdc.balanceOf(address(commerce)), 0);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 8: REVERT — FUND WRONG AMOUNT
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_RevertFundWrongAmount() public {
        uint256 jobId = _createAndBudget();

        vm.startPrank(client);
        usdc.approve(address(commerce), BUDGET_100);

        // Fund with wrong expectedBudget
        vm.expectRevert(TestableGigaWorkCommerce.BudgetMismatch.selector);
        commerce.fund(jobId, BUDGET_5, ""); // budget is 100, passing 5

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 9: REVERT — SUBMIT NOT PROVIDER
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_RevertSubmitNotProvider() public {
        uint256 jobId = _createBudgetAndFund();

        vm.prank(randomUser);
        vm.expectRevert(TestableGigaWorkCommerce.NotProvider.selector);
        commerce.submit(jobId, keccak256("fake"), "");
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 10: REVERT — COMPLETE NOT EVALUATOR
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_RevertCompleteNotEvaluator() public {
        uint256 jobId = _createBudgetFundAndSubmit();

        vm.prank(randomUser);
        vm.expectRevert(TestableGigaWorkCommerce.NotEvaluator.selector);
        commerce.complete(jobId, keccak256("fake"), "");

        // Provider also can't complete
        vm.prank(provider);
        vm.expectRevert(TestableGigaWorkCommerce.NotEvaluator.selector);
        commerce.complete(jobId, keccak256("self-approve"), "");
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 11: BID AND ACCEPT (marketplace flow)
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_BidAndAccept() public {
        // Create job with no provider
        vm.prank(client);
        uint256 jobId = commerce.createJob(
            address(0), // no provider
            evaluator,
            block.timestamp + 1 hours,
            "open marketplace job",
            ""
        );

        TestableGigaWorkCommerce.Job memory job = commerce.getJob(jobId);
        assertEq(job.provider, address(0));

        // Provider bids
        vm.prank(provider);
        commerce.bid(jobId, "I can do this");

        TestableGigaWorkCommerce.Bid[] memory jobBids = commerce.getBids(jobId);
        assertEq(jobBids.length, 1);
        assertEq(jobBids[0].agent, provider);
        assertEq(jobBids[0].proposedRate, RATE_10);

        // Client accepts bid with budget
        vm.prank(client);
        commerce.acceptBid(jobId, provider, BUDGET_100);

        job = commerce.getJob(jobId);
        assertEq(job.provider, provider);
        assertEq(job.budget, BUDGET_100);

        // Now fund and complete the full flow
        vm.startPrank(client);
        usdc.approve(address(commerce), BUDGET_100);
        commerce.fund(jobId, BUDGET_100, "");
        vm.stopPrank();

        vm.prank(provider);
        commerce.submit(jobId, keccak256("bid result"), "");

        uint256 providerBalBefore = usdc.balanceOf(provider);

        vm.prank(evaluator);
        commerce.complete(jobId, keccak256("good"), "");

        job = commerce.getJob(jobId);
        assertEq(uint8(job.status), uint8(IERC8183.JobStatus.Completed));
        assertEq(usdc.balanceOf(provider) - providerBalBefore, 95_000_000);
    }

    // ═══════════════════════════════════════════════════════════
    //  TEST 12: FEE CALCULATION — NO DUST
    // ═══════════════════════════════════════════════════════════

    function test_Commerce_FeeCalculation() public {
        // Use a budget that tests rounding: 7 USDC
        uint256 budget7 = 7_000_000;

        vm.prank(client);
        uint256 jobId = commerce.createJob(provider, evaluator, block.timestamp + 1 hours, "fee test", "");

        vm.prank(provider);
        commerce.setBudget(jobId, budget7, "");

        vm.startPrank(client);
        usdc.approve(address(commerce), budget7);
        commerce.fund(jobId, budget7, "");
        vm.stopPrank();

        vm.prank(provider);
        commerce.submit(jobId, keccak256("result"), "");

        uint256 providerBal = usdc.balanceOf(provider);
        uint256 treasuryBal = usdc.balanceOf(treasury);

        vm.prank(evaluator);
        commerce.complete(jobId, keccak256("ok"), "");

        // fee = 7_000_000 * 500 / 10000 = 350_000
        // payout = 7_000_000 - 350_000 = 6_650_000
        uint256 actualFee = usdc.balanceOf(treasury) - treasuryBal;
        uint256 actualPayout = usdc.balanceOf(provider) - providerBal;

        assertEq(actualFee, 350_000);
        assertEq(actualPayout, 6_650_000);

        // fee + payout must equal budget exactly (no dust)
        assertEq(actualFee + actualPayout, budget7);

        // Contract must have zero balance
        assertEq(usdc.balanceOf(address(commerce)), 0);
    }
}
