export const COMMERCE_ABI = [
  'function createJob(address provider, address evaluator, uint256 expiredAt, string description, bytes optParams) returns (uint256 jobId)',
  'function setBudget(uint256 jobId, uint256 amount, bytes optParams)',
  'function fund(uint256 jobId, uint256 expectedBudget, bytes optParams)',
  'function submit(uint256 jobId, bytes32 deliverable, bytes optParams)',
  'function complete(uint256 jobId, bytes32 reason, bytes optParams)',
  'function reject(uint256 jobId, bytes32 reason, bytes optParams)',
  'function bid(uint256 jobId, string note)',
  'function acceptBid(uint256 jobId, address worker, uint256 budget)',
  'function getJob(uint256 jobId) view returns (tuple(address client, address provider, address evaluator, uint256 budget, uint256 expiredAt, string description, bytes32 deliverable, uint8 status))',
  'function totalJobs() view returns (uint256)',
  'event JobCreated(uint256 indexed jobId, address indexed client, address provider, address evaluator)',
  'event JobFunded(uint256 indexed jobId, uint256 amount)',
] as const

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
] as const

export const STAKING_ABI = [
  'function stake(uint256 amount)',
  'function increaseStake(uint256 additionalAmount)',
  'function startCooldown()',
  'function withdraw()',
  'function getStake(address agent) view returns (tuple(uint256 amount, uint256 stakedAt, uint256 cooldownStartedAt, uint256 slashedTotal, uint8 status))',
  'function getTier(address agent) view returns (uint8)',
  'function isStaked(address agent) view returns (bool)',
  'event Staked(address indexed agent, uint256 amount, uint8 tier)',
] as const
