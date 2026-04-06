// GigaWork Contract Constants & ABIs
// Updated for ERC-8004 Identity + ERC-8183 Commerce integration
const ARC_CHAIN_ID = 5042002;
const ARC_CHAIN_HEX = '0x4cef52';
const ARC_RPC = 'https://rpc.drpc.testnet.arc.network';

const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const ESCROW_ADDRESS = '0x92FA695562B6877BeE09EE826821Fbe8Ae6faf46'; // Legacy
const REGISTRY_ADDRESS = '0x26BAB1CD090c1a44C189dCfd9D32d3AC80bfD0d1';
const STAKING_ADDRESS = '0x5aC6d607B33C02268a86E0D28Ee9Cbe086AE214f';

// ─── ERC-8004: Identity Registry (pre-deployed on Arc Testnet) ───
const IDENTITY_REGISTRY_ADDRESS = '0x8004A818BFB912233c491871b3d84c89A494BD9e';

// ─── ERC-8183: Commerce Contract (deployed on Arc Testnet) ───
const COMMERCE_ADDRESS = '0xefe28b2fb1146a5d95c7e5e134cef7a180d47e34';

const USDC_DECIMALS = 6; // ERC-20 USDC on Arc uses 6 decimals

// Minimal ERC-20 ABI
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function decimals() view returns (uint8)'
];

// ─── ERC-8004: Identity Registry ABI ─────────────────────────────
const IDENTITY_ABI = [
    'function register(string metadataURI) returns (uint256)',
    'function register() returns (uint256)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function balanceOf(address owner) view returns (uint256)',
    'function setAgentURI(uint256 agentId, string newURI)',
    'function getAgentWallet(uint256 agentId) view returns (address)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)'
];

// ─── ERC-8183: Commerce ABI (GigaWorkCommerce) ───────────────────
const COMMERCE_ABI = [
    // Core ERC-8183 functions
    'function createJob(address provider, address evaluator, uint256 expiredAt, string description, bytes optParams) returns (uint256 jobId)',
    'function setProvider(uint256 jobId, address provider, bytes optParams)',
    'function setBudget(uint256 jobId, uint256 amount, bytes optParams)',
    'function fund(uint256 jobId, uint256 expectedBudget, bytes optParams)',
    'function submit(uint256 jobId, bytes32 deliverable, bytes optParams)',
    'function complete(uint256 jobId, bytes32 reason, bytes optParams)',
    'function reject(uint256 jobId, bytes32 reason, bytes optParams)',
    'function claimRefund(uint256 jobId)',
    // Marketplace extensions
    'function bid(uint256 jobId, string note)',
    'function acceptBid(uint256 jobId, address worker, uint256 budget)',
    // Views
    'function getJob(uint256 jobId) view returns (tuple(address client, address provider, address evaluator, uint256 budget, uint256 expiredAt, string description, bytes32 deliverable, uint8 status))',
    'function getBids(uint256 jobId) view returns (tuple(address agent, uint256 proposedRate, string note, bool accepted)[])',
    'function totalJobs() view returns (uint256)',
    // Events
    'event JobCreated(uint256 indexed jobId, address indexed client, address provider, address evaluator)',
    'event BudgetSet(uint256 indexed jobId, uint256 amount, address indexed setter)',
    'event JobFunded(uint256 indexed jobId, uint256 amount)',
    'event JobSubmitted(uint256 indexed jobId, bytes32 deliverable)',
    'event JobCompleted(uint256 indexed jobId, bytes32 reason)',
    'event JobRejected(uint256 indexed jobId, bytes32 reason, address indexed rejector)',
    'event BidSubmitted(uint256 indexed jobId, address indexed agent, uint256 proposedRate)',
    'event BidAccepted(uint256 indexed jobId, address indexed worker, uint256 agreedRate)'
];

// ─── Legacy: GigaWorkEscrow ABI (kept for reading old jobs) ──────
const ESCROW_ABI = [
    'function postJob(uint8 jobType, uint256 estimatedHours, address agentAddress, bytes spec) returns (uint256 jobId)',
    'function bid(uint256 jobId, string note)',
    'function acceptBid(uint256 jobId, address worker)',
    'function submitResult(uint256 jobId, bytes32 resultHash, string proofURI)',
    'function approveResult(uint256 jobId, int256 rating)',
    'function autoSettle(uint256 jobId)',
    'function raiseDispute(uint256 jobId, string reason)',
    'function getJob(uint256 jobId) view returns (tuple(uint256 jobId, address employer, address workerAgent, uint8 jobType, uint256 hourlyRateUSDC, uint256 estimatedHours, uint256 depositAmount, uint256 startTimestamp, uint256 endTimestamp, uint256 resultSubmittedAt, bytes32 resultHash, string proofURI, bytes spec, uint8 status, int256 employerRating))',
    'function totalJobs() view returns (uint256)',
    'event JobPosted(uint256 indexed jobId, address indexed employer, uint8 jobType, uint256 estimatedHours, uint256 deposit)'
];

// GigaWorkRegistry ABI (frontend-relevant functions)
const REGISTRY_ABI = [
    'function register(uint256 erc8004TokenId, uint256 hourlyRateUSDC, string[] skillTags)',
    'function updateProfile(uint256 newHourlyRate, bool isActive)',
    'function getProfile(address agent) view returns (tuple(uint256 erc8004TokenId, address owner, uint256 hourlyRateUSDC, string[] skillTags, uint256 reputationScore, uint256 totalJobsDone, uint256 totalEarnedUSDC, bool isActive, uint256 registeredAt))',
    'event AgentRegistered(address indexed agent, uint256 erc8004TokenId, uint256 hourlyRate)'
];

// GigaWorkStaking ABI
const STAKING_ABI = [
    'function stake(uint256 amount)',
    'function increaseStake(uint256 additionalAmount)',
    'function startCooldown()',
    'function withdraw()',
    'function getStake(address agent) view returns (tuple(uint256 amount, uint256 stakedAt, uint256 cooldownStartedAt, uint256 slashedTotal, uint8 status))',
    'function getTier(address agent) view returns (uint8)',
    'function isStaked(address agent) view returns (bool)',
    'function MIN_STAKE() view returns (uint256)',
    'function SILVER_THRESHOLD() view returns (uint256)',
    'function GOLD_THRESHOLD() view returns (uint256)',
    'event Staked(address indexed agent, uint256 amount, uint8 tier)',
    'event Slashed(address indexed agent, uint256 slashAmount, uint256 remaining)'
];

const STAKE_TIERS = {
    0: { name: 'NONE', color: '#606080', min: 0 },
    1: { name: 'BRONZE', color: '#cd7f32', min: 5 },
    2: { name: 'SILVER', color: '#c0c0c0', min: 25 },
    3: { name: 'GOLD', color: '#ffd700', min: 100 }
};

// ERC-8183 Job Status mapping
const JOB_STATUS_8183 = {
    0: 'OPEN',
    1: 'FUNDED',
    2: 'SUBMITTED',
    3: 'COMPLETED',
    4: 'REJECTED',
    5: 'EXPIRED'
};

// Arc Testnet network config for wallet_addEthereumChain
const ARC_NETWORK = {
    chainId: ARC_CHAIN_HEX,
    chainName: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: [ARC_RPC],
    blockExplorerUrls: ['https://testnet.arcscan.app']
};

// Helper: parse USDC (6 decimals)
function parseUSDC(amount) {
    return ethers.parseUnits(amount.toString(), USDC_DECIMALS);
}

// Helper: format USDC (6 decimals)
function formatUSDC(amount) {
    return ethers.formatUnits(amount, USDC_DECIMALS);
}
