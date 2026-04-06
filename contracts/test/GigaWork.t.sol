// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./mocks/MockIdentityRegistry.sol";
import "./mocks/MockUSDC.sol";
import "./mocks/TestableGigaWorkRegistry.sol";
import "./mocks/TestableGigaWorkEscrow.sol";

contract GigaWorkTest is Test {
    MockIdentityRegistry identityRegistry;
    MockUSDC usdc;
    TestableGigaWorkRegistry registry;
    TestableGigaWorkEscrow escrow;

    address employer = makeAddr("employer");
    address worker = makeAddr("worker");
    address worker2 = makeAddr("worker2");
    address treasury = makeAddr("treasury");
    address randomUser = makeAddr("randomUser");

    uint256 workerTokenId;
    uint256 worker2TokenId;

    uint256 constant RATE_5_USDC = 5_000_000; // 5 USDC/hr (6 decimals)
    uint256 constant RATE_10_USDC = 10_000_000;

    function setUp() public {
        // Deploy mocks
        identityRegistry = new MockIdentityRegistry();
        usdc = new MockUSDC();

        // Deploy testable contracts
        registry = new TestableGigaWorkRegistry(address(identityRegistry));
        escrow = new TestableGigaWorkEscrow(address(usdc), address(registry), treasury);

        // Transfer registry ownership to escrow
        registry.transferOwnership(address(escrow));

        // Mint ERC-8004 tokens for workers
        vm.prank(worker);
        workerTokenId = identityRegistry.mint(worker);

        vm.prank(worker2);
        worker2TokenId = identityRegistry.mint(worker2);

        // Register workers
        string[] memory tags = new string[](2);
        tags[0] = "llm";
        tags[1] = "onchain";

        vm.prank(worker);
        registry.register(workerTokenId, RATE_10_USDC, tags);

        string[] memory tags2 = new string[](1);
        tags2[0] = "scraping";

        vm.prank(worker2);
        registry.register(worker2TokenId, RATE_5_USDC, tags2);

        // Fund employer with USDC
        usdc.mint(employer, 1_000_000_000); // 1000 USDC
    }

    // ═══════════════════════════════════════════════════════════
    //  REGISTRY TESTS
    // ═══════════════════════════════════════════════════════════

    function test_RegisterAgent() public view {
        TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(worker);
        assertEq(p.erc8004TokenId, workerTokenId);
        assertEq(p.owner, worker);
        assertEq(p.hourlyRateUSDC, RATE_10_USDC);
        assertEq(p.reputationScore, 500);
        assertEq(p.isActive, true);
        assertGt(p.registeredAt, 0);
    }

    function test_RevertDoubleRegister() public {
        string[] memory tags = new string[](0);
        vm.prank(worker);
        vm.expectRevert(TestableGigaWorkRegistry.AgentAlreadyRegistered.selector);
        registry.register(workerTokenId, RATE_5_USDC, tags);
    }

    function test_RevertNotTokenOwner() public {
        uint256 tokenId = identityRegistry.mint(makeAddr("other"));
        string[] memory tags = new string[](0);

        vm.prank(worker);
        vm.expectRevert(TestableGigaWorkRegistry.NotTokenOwner.selector);
        registry.register(tokenId, RATE_5_USDC, tags);
    }

    function test_RevertZeroRate() public {
        address newAgent = makeAddr("newAgent");
        uint256 tokenId = identityRegistry.mint(newAgent);
        string[] memory tags = new string[](0);

        vm.prank(newAgent);
        vm.expectRevert(TestableGigaWorkRegistry.InvalidHourlyRate.selector);
        registry.register(tokenId, 0, tags);
    }

    function test_UpdateProfile() public {
        vm.prank(worker);
        registry.updateProfile(RATE_5_USDC, false);

        TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(worker);
        assertEq(p.hourlyRateUSDC, RATE_5_USDC);
        assertEq(p.isActive, false);
    }

    function test_GetAgentsByTag() public view {
        address[] memory llmAgents = registry.getAgentsByTag("llm");
        assertEq(llmAgents.length, 1);
        assertEq(llmAgents[0], worker);

        address[] memory scrapingAgents = registry.getAgentsByTag("scraping");
        assertEq(scrapingAgents.length, 1);
        assertEq(scrapingAgents[0], worker2);
    }

    function test_TotalAgents() public view {
        assertEq(registry.totalAgents(), 2);
    }

    // ═══════════════════════════════════════════════════════════
    //  ESCROW — POST JOB TESTS
    // ═══════════════════════════════════════════════════════════

    function test_PostJobOpenMarket() public {
        vm.prank(employer);
        uint256 jobId = escrow.postJob(
            TestableGigaWorkEscrow.JobType.ONCHAIN,
            4, // 4 hours
            address(0), // open market
            bytes("test spec")
        );

        TestableGigaWorkEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.employer, employer);
        assertEq(uint8(job.status), uint8(TestableGigaWorkEscrow.JobStatus.OPEN));
        assertEq(job.depositAmount, 0); // no deposit for open market
        assertEq(job.estimatedHours, 4);
    }

    function test_PostJobWithAgent() public {
        // Approve USDC first
        vm.startPrank(employer);
        usdc.approve(address(escrow), type(uint256).max);

        uint256 jobId = escrow.postJob(
            TestableGigaWorkEscrow.JobType.OFFCHAIN_AI,
            5, // 5 hours
            worker, // invite specific agent
            bytes("ai task spec")
        );
        vm.stopPrank();

        TestableGigaWorkEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.workerAgent, worker);
        assertEq(uint8(job.status), uint8(TestableGigaWorkEscrow.JobStatus.MATCHING));
        // deposit = 10 USDC/hr × 5hr × 1.2 = 60 USDC = 60_000_000
        assertEq(job.depositAmount, 60_000_000);
        assertEq(job.hourlyRateUSDC, RATE_10_USDC);
    }

    function test_RevertZeroHours() public {
        vm.prank(employer);
        vm.expectRevert(TestableGigaWorkEscrow.InvalidEstimatedHours.selector);
        escrow.postJob(TestableGigaWorkEscrow.JobType.ONCHAIN, 0, address(0), bytes(""));
    }

    // ═══════════════════════════════════════════════════════════
    //  ESCROW — BID + ACCEPT TESTS
    // ═══════════════════════════════════════════════════════════

    function test_BidAndAccept() public {
        // Post open market job
        vm.prank(employer);
        uint256 jobId = escrow.postJob(
            TestableGigaWorkEscrow.JobType.SCRAPING,
            3,
            address(0),
            bytes("scrape spec")
        );

        // Worker bids
        vm.prank(worker);
        escrow.bid(jobId, "I can do this");

        TestableGigaWorkEscrow.Bid[] memory jobBids = escrow.getBids(jobId);
        assertEq(jobBids.length, 1);
        assertEq(jobBids[0].agent, worker);
        assertEq(jobBids[0].proposedRate, RATE_10_USDC);

        // Employer accepts bid (needs USDC approval)
        vm.startPrank(employer);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.acceptBid(jobId, worker);
        vm.stopPrank();

        TestableGigaWorkEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(TestableGigaWorkEscrow.JobStatus.IN_PROGRESS));
        assertEq(job.workerAgent, worker);
        // deposit = 10 × 3 × 1.2 = 36 USDC
        assertEq(job.depositAmount, 36_000_000);
        assertGt(job.startTimestamp, 0);
    }

    function test_RevertBidOnNonOpenJob() public {
        vm.startPrank(employer);
        usdc.approve(address(escrow), type(uint256).max);
        uint256 jobId = escrow.postJob(
            TestableGigaWorkEscrow.JobType.ONCHAIN,
            3,
            worker,
            bytes("spec")
        );
        vm.stopPrank();

        // Job is in MATCHING status, not OPEN
        vm.prank(worker2);
        vm.expectRevert();
        escrow.bid(jobId, "too late");
    }

    // ═══════════════════════════════════════════════════════════
    //  ESCROW — FULL LIFECYCLE TESTS
    // ═══════════════════════════════════════════════════════════

    function test_FullJobLifecycle() public {
        // 1. Post job
        vm.prank(employer);
        uint256 jobId = escrow.postJob(
            TestableGigaWorkEscrow.JobType.ONCHAIN,
            5,
            address(0),
            bytes("monitor wallet")
        );

        // 2. Worker bids
        vm.prank(worker);
        escrow.bid(jobId, "I'll do it");

        // 3. Employer accepts
        vm.startPrank(employer);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.acceptBid(jobId, worker);
        vm.stopPrank();

        // 4. Time passes (3 hours of work)
        vm.warp(block.timestamp + 3 hours);

        // 5. Worker submits result
        bytes32 resultHash = keccak256("job result data");
        vm.prank(worker);
        escrow.submitResult(jobId, resultHash, "ipfs://proof123");

        TestableGigaWorkEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(TestableGigaWorkEscrow.JobStatus.PENDING_REVIEW));
        assertEq(job.resultHash, resultHash);

        // 6. Employer approves
        uint256 workerBalBefore = usdc.balanceOf(worker);
        uint256 treasuryBalBefore = usdc.balanceOf(treasury);
        uint256 employerBalBefore = usdc.balanceOf(employer);

        vm.prank(employer);
        escrow.approveResult(jobId, 80); // positive rating

        job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(TestableGigaWorkEscrow.JobStatus.SETTLED));

        // Verify payouts:
        // actual_charge = 10 USDC × 3hr = 30 USDC = 30_000_000
        // fee = 30_000_000 × 500 / 10000 = 1_500_000
        // worker_pay = 30_000_000 - 1_500_000 = 28_500_000
        // refund = 60_000_000 - 30_000_000 = 30_000_000
        assertEq(usdc.balanceOf(worker) - workerBalBefore, 28_500_000);
        assertEq(usdc.balanceOf(treasury) - treasuryBalBefore, 1_500_000);
        assertEq(usdc.balanceOf(employer) - employerBalBefore, 30_000_000);

        // Verify reputation updated
        TestableGigaWorkRegistry.AgentProfile memory p = registry.getProfile(worker);
        assertEq(p.totalJobsDone, 1);
        assertEq(p.totalEarnedUSDC, 28_500_000);
        assertEq(p.reputationScore, 508); // 500 + (80/10) = 508
    }

    function test_AutoSettle() public {
        // Setup: post → bid → accept → submit
        vm.prank(employer);
        uint256 jobId = escrow.postJob(
            TestableGigaWorkEscrow.JobType.WORKFLOW,
            2,
            address(0),
            bytes("workflow task")
        );

        vm.prank(worker);
        escrow.bid(jobId, "on it");

        vm.startPrank(employer);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.acceptBid(jobId, worker);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 hours);

        vm.prank(worker);
        escrow.submitResult(jobId, keccak256("result"), "ipfs://proof");

        // Try auto-settle too early
        vm.expectRevert(TestableGigaWorkEscrow.TooEarlyToAutoSettle.selector);
        escrow.autoSettle(jobId);

        // Warp past 24h
        vm.warp(block.timestamp + 25 hours);

        // Anyone can auto-settle
        vm.prank(randomUser);
        escrow.autoSettle(jobId);

        TestableGigaWorkEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(TestableGigaWorkEscrow.JobStatus.SETTLED));
    }

    // ═══════════════════════════════════════════════════════════
    //  ESCROW — DISPUTE TESTS
    // ═══════════════════════════════════════════════════════════

    function test_DisputeWorkerWins() public {
        (uint256 jobId,) = _setupInProgressJob();

        vm.warp(block.timestamp + 2 hours);

        vm.prank(worker);
        escrow.submitResult(jobId, keccak256("result"), "ipfs://proof");

        // Employer disputes
        vm.prank(employer);
        escrow.raiseDispute(jobId, "Not satisfied");

        TestableGigaWorkEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(TestableGigaWorkEscrow.JobStatus.DISPUTED));

        // Owner resolves — worker wins
        uint256 workerBalBefore = usdc.balanceOf(worker);
        escrow.resolveDispute(jobId, true);

        job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(TestableGigaWorkEscrow.JobStatus.SETTLED));
        assertGt(usdc.balanceOf(worker), workerBalBefore);
    }

    function test_DisputeEmployerWins() public {
        (uint256 jobId, uint256 depositAmount) = _setupInProgressJob();

        vm.warp(block.timestamp + 2 hours);

        vm.prank(worker);
        escrow.submitResult(jobId, keccak256("bad result"), "ipfs://proof");

        vm.prank(employer);
        escrow.raiseDispute(jobId, "Work is garbage");

        uint256 employerBalBefore = usdc.balanceOf(employer);
        escrow.resolveDispute(jobId, false);

        TestableGigaWorkEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(TestableGigaWorkEscrow.JobStatus.EXPIRED));
        assertEq(usdc.balanceOf(employer) - employerBalBefore, depositAmount);
    }

    function test_RevertDisputeByNonParty() public {
        (uint256 jobId,) = _setupInProgressJob();

        vm.prank(randomUser);
        vm.expectRevert(TestableGigaWorkEscrow.NotParty.selector);
        escrow.raiseDispute(jobId, "none of my business");
    }

    // ═══════════════════════════════════════════════════════════
    //  ESCROW — ACCESS CONTROL TESTS
    // ═══════════════════════════════════════════════════════════

    function test_RevertAcceptBidNotEmployer() public {
        vm.prank(employer);
        uint256 jobId = escrow.postJob(
            TestableGigaWorkEscrow.JobType.ONCHAIN, 3, address(0), bytes("spec")
        );

        vm.prank(worker);
        escrow.bid(jobId, "bidding");

        vm.prank(randomUser);
        vm.expectRevert(TestableGigaWorkEscrow.NotEmployer.selector);
        escrow.acceptBid(jobId, worker);
    }

    function test_RevertSubmitResultNotWorker() public {
        (uint256 jobId,) = _setupInProgressJob();

        vm.prank(randomUser);
        vm.expectRevert(TestableGigaWorkEscrow.NotWorker.selector);
        escrow.submitResult(jobId, keccak256("fake"), "ipfs://fake");
    }

    function test_RevertApproveResultNotEmployer() public {
        (uint256 jobId,) = _setupInProgressJob();

        vm.warp(block.timestamp + 1 hours);
        vm.prank(worker);
        escrow.submitResult(jobId, keccak256("result"), "ipfs://proof");

        vm.prank(randomUser);
        vm.expectRevert(TestableGigaWorkEscrow.NotEmployer.selector);
        escrow.approveResult(jobId, 50);
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════

    function _setupInProgressJob() internal returns (uint256 jobId, uint256 depositAmount) {
        vm.prank(employer);
        jobId = escrow.postJob(
            TestableGigaWorkEscrow.JobType.ONCHAIN,
            5,
            address(0),
            bytes("test job")
        );

        vm.prank(worker);
        escrow.bid(jobId, "I'll do it");

        vm.startPrank(employer);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.acceptBid(jobId, worker);
        vm.stopPrank();

        depositAmount = escrow.getJob(jobId).depositAmount;
    }
}
