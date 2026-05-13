/**
 * agenticCommerce — real ERC-8183 lifecycle on Arc Testnet.
 *
 * One workflow = one ERC-8183 job. The platform admin wallet acts as
 * both client and evaluator (and currently as provider too) so the
 * lifecycle can run server-side without dragging the user through 5+
 * Privy signature prompts. Per-user-controlled providers come later.
 *
 * Flow (all from `adminWallet`):
 *   1. createJob(provider, evaluator, expiredAt, description, hook=0)
 *      → returns jobId from the JobCreated event
 *   2. setBudget(jobId, budget, "0x")
 *   3. USDC.approve(AGENTIC_COMMERCE, budget) — let escrow pull funds
 *   4. fund(jobId, "0x") → status: Funded
 *   5. submit(jobId, deliverableHash, "0x") → status: Submitted
 *   6. complete(jobId, reasonHash, "0x") → status: Completed (USDC settles)
 *
 * Steps 1–4 fire when a workflow is created (open + funded). Steps 5–6
 * fire when the brain emits finalizeReport. Each tx hash + the jobId
 * are persisted on the `workflows` row so the UI can render real explorer
 * links instead of the old "self-tx with JSON envelope" calldata audit.
 *
 * Gated by env `ERC8183_ENABLED=1`. When disabled, helpers no-op and
 * return `null` so the existing dispatch envelope path still runs.
 */
import { decodeEventLog, decodeFunctionData, getAddress, keccak256, parseAbi, parseUnits, toHex, type Hex } from 'viem'

import { adminAccount, pollingClient, publicClient, sendAdminTransaction } from './client'

const AGENTIC_COMMERCE = (process.env.AGENTIC_COMMERCE_ADDRESS ??
  '0x0747EEf0706327138c69792bF28Cd525089e4583') as `0x${string}`

const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as `0x${string}`
const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')
const MAX_UINT256 = (1n << 256n) - 1n

export const ERC8183_ENABLED = process.env.ERC8183_ENABLED === '1'

const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
])

const agenticCommerceAbi = [
  {
    type: 'function',
    name: 'getJob',
    stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'client', type: 'address' },
          { name: 'provider', type: 'address' },
          { name: 'evaluator', type: 'address' },
          { name: 'description', type: 'string' },
          { name: 'budget', type: 'uint256' },
          { name: 'expiredAt', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'hook', type: 'address' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'jobs',
    stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'client', type: 'address' },
          { name: 'provider', type: 'address' },
          { name: 'evaluator', type: 'address' },
          { name: 'description', type: 'string' },
          { name: 'budget', type: 'uint256' },
          { name: 'expiredAt', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'hook', type: 'address' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'createJob',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'evaluator', type: 'address' },
      { name: 'expiredAt', type: 'uint256' },
      { name: 'description', type: 'string' },
      { name: 'hook', type: 'address' },
    ],
    outputs: [{ name: 'jobId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'setBudget',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'fund',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'submit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'deliverable', type: 'bytes32' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'complete',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'reason', type: 'bytes32' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'JobCreated',
    inputs: [
      { indexed: true, name: 'jobId', type: 'uint256' },
      { indexed: true, name: 'client', type: 'address' },
      { indexed: true, name: 'provider', type: 'address' },
      { indexed: false, name: 'evaluator', type: 'address' },
      { indexed: false, name: 'expiredAt', type: 'uint256' },
      { indexed: false, name: 'hook', type: 'address' },
    ],
    anonymous: false,
  },
] as const

export interface OpenAndFundResult {
  jobId: string
  createTx: Hex
  setBudgetTx: Hex
  approveTx: Hex
  fundTx: Hex
  contract: `0x${string}`
  budgetUsdc: string
}

export interface SettleResult {
  submitTx: Hex | null
  completeTx: Hex | null
  deliverableHash: Hex
  reasonHash: Hex
}

/**
 * Send a tx from the admin wallet and wait for 1 confirmation.
 * Throws on revert. Returns the tx hash + receipt.
 */
async function adminSend(to: `0x${string}`, data: Hex): Promise<{ hash: Hex; receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>> }> {
  if (!adminAccount) {
    throw new Error('admin wallet not configured (ADMIN_PRIVATE_KEY missing)')
  }
  const hash = await sendAdminTransaction({ to, data })
  if (!hash) throw new Error('failed to broadcast admin transaction')

  const receipt = await pollingClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
    pollingInterval: 1_500, // Speed up polling from 3s to 1.5s
  })
  if (receipt.status !== 'success') {
    throw new Error(`tx ${hash} reverted`)
  }
  return { hash, receipt }
}

async function waitForTxVisibility(hash: Hex, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tx = await publicClient.getTransaction({ hash })
      if (tx) return true
    } catch {
      // Keep polling until timeout. Some RPC nodes need a short propagation delay.
    }
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
  return false
}

/**
 * Create the job, set the budget, approve USDC, and fund the escrow.
 * Returns the jobId + every tx hash so the caller can persist the trail.
 *
 * `budgetUsdc` is in human units (e.g., "0.1" = 0.1 USDC). Kept tiny on
 * testnet so the admin wallet's faucet balance survives many workflows.
 */
export async function openAndFundJob(args: {
  description: string
  budgetUsdc: string
  expirySeconds?: number
}): Promise<OpenAndFundResult | null> {
  if (!ERC8183_ENABLED || !adminAccount) return null

  const me = adminAccount.address
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + (args.expirySeconds ?? 24 * 3600))
  const budget = parseUnits(args.budgetUsdc, USDC_DECIMALS)

  // Step 1 — createJob. Admin acts as client, provider, and evaluator
  // (single-party demo flow). Hook = address(0) for the default path.
  const createData = encodeCreateJob(me, me, expiredAt, args.description)
  const create = await adminSend(AGENTIC_COMMERCE, createData)
  const jobId = extractJobIdFromReceipt(create.receipt.logs)
  if (!jobId) throw new Error('JobCreated event missing from receipt')

  // Step 2 & 3 — Check allowance & Approve (Max), setBudget, and fund.
  // Keep admin txs serialized to avoid nonce collisions with dispatch/finalize.
  let approveHash: Hex = '0x0'
  const allowance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [me, AGENTIC_COMMERCE],
  })

  if (allowance < budget) {
    const approveData = encodeApprove(AGENTIC_COMMERCE, MAX_UINT256)
    const approve = await adminSend(USDC_ADDRESS, approveData)
    approveHash = approve.hash
  }

  const setBudgetData = encodeSetBudget(jobId, budget)
  const setBudget = await adminSend(AGENTIC_COMMERCE, setBudgetData)

  const fundData = encodeFund(jobId)
  const fund = await adminSend(AGENTIC_COMMERCE, fundData)

  return {
    jobId: jobId.toString(),
    createTx: create.hash,
    setBudgetTx: setBudget.hash,
    approveTx: approveHash,
    fundTx: fund.hash,
    contract: AGENTIC_COMMERCE,
    budgetUsdc: args.budgetUsdc,
  }
}

/**
 * Submit the deliverable hash and complete the job. Splits 95/5 settles
 * USDC per the contract's payout math (admin owns both sides on this
 * demo so net effect is zero, but the trail is still real).
 */
export async function settleJob(args: {
  jobId: string
  deliverableSeed: string
  reasonSeed?: string
}): Promise<SettleResult | null> {
  if (!ERC8183_ENABLED || !adminAccount) return null

  const jobId = BigInt(args.jobId)
  const deliverableHash = keccak256(toHex(args.deliverableSeed))
  const reasonHash = keccak256(toHex(args.reasonSeed ?? 'deliverable-approved'))

  const status = await readJobStatus(jobId)
  const submitData = encodeSubmit(jobId, deliverableHash)
  const completeData = encodeComplete(jobId, reasonHash)

  if (status === 3) {
    return {
      submitTx: null,
      completeTx: null,
      deliverableHash,
      reasonHash,
    }
  }

  if (status === 2) {
    const complete = await adminSend(AGENTIC_COMMERCE, completeData)
    return {
      submitTx: null,
      completeTx: complete.hash,
      deliverableHash,
      reasonHash,
    }
  }

  if (status !== 1) {
    throw new Error(`job ${jobId} is not funded; current ERC-8183 status=${status}`)
  }

  const submit = await adminSend(AGENTIC_COMMERCE, submitData)
  const complete = await adminSend(AGENTIC_COMMERCE, completeData)

  return {
    submitTx: submit.hash,
    completeTx: complete.hash,
    deliverableHash,
    reasonHash,
  }
}

export async function readJobStatus(jobId: bigint) {
  const job = await publicClient.readContract({
    address: AGENTIC_COMMERCE,
    abi: agenticCommerceAbi,
    functionName: 'getJob',
    args: [jobId],
  })
  return Number(job.status)
}

async function findExistingSettlementTxs(jobId: bigint): Promise<{
  submitTx: Hex | null
  completeTx: Hex | null
  deliverableHash: Hex | null
} | null> {
  const latest = await publicClient.getBlockNumber()
  const from = latest > 5_000n ? latest - 5_000n : 0n
  let submitTx: Hex | null = null
  let completeTx: Hex | null = null
  let deliverableHash: Hex | null = null

  for (let blockNumber = latest; blockNumber >= from; blockNumber--) {
    const block = await publicClient.getBlock({ blockNumber, includeTransactions: true })
    for (const tx of block.transactions) {
      if (tx.to?.toLowerCase() !== AGENTIC_COMMERCE.toLowerCase()) continue
      try {
        const decoded = decodeFunctionData({ abi: agenticCommerceAbi, data: tx.input })
        if (decoded.functionName !== 'submit' && decoded.functionName !== 'complete') continue
        if (decoded.args[0] !== jobId) continue
        if (decoded.functionName === 'submit') {
          submitTx = tx.hash
          deliverableHash = decoded.args[1]
        }
        if (decoded.functionName === 'complete') completeTx = tx.hash
      } catch {
        /* not an ERC-8183 settlement call */
      }
    }
    if (submitTx && completeTx && deliverableHash) break
    if (blockNumber === 0n) break
  }

  return submitTx || completeTx || deliverableHash
    ? { submitTx, completeTx, deliverableHash }
    : null
}

// ─── Calldata encoders ────────────────────────────────────────────────
// We use viem's encodeFunctionData via a thin wrapper so the ABI lives
// in one place and TypeScript checks the args.

import { encodeFunctionData } from 'viem'

function encodeCreateJob(provider: `0x${string}`, evaluator: `0x${string}`, expiredAt: bigint, description: string): Hex {
  return encodeFunctionData({
    abi: agenticCommerceAbi,
    functionName: 'createJob',
    args: [getAddress(provider), getAddress(evaluator), expiredAt, description, '0x0000000000000000000000000000000000000000'],
  })
}

function encodeSetBudget(jobId: bigint, amount: bigint): Hex {
  return encodeFunctionData({
    abi: agenticCommerceAbi,
    functionName: 'setBudget',
    args: [jobId, amount, '0x'],
  })
}

function encodeFund(jobId: bigint): Hex {
  return encodeFunctionData({
    abi: agenticCommerceAbi,
    functionName: 'fund',
    args: [jobId, '0x'],
  })
}

function encodeSubmit(jobId: bigint, deliverable: Hex): Hex {
  return encodeFunctionData({
    abi: agenticCommerceAbi,
    functionName: 'submit',
    args: [jobId, deliverable, '0x'],
  })
}

function encodeComplete(jobId: bigint, reason: Hex): Hex {
  return encodeFunctionData({
    abi: agenticCommerceAbi,
    functionName: 'complete',
    args: [jobId, reason, '0x'],
  })
}

function encodeApprove(spender: `0x${string}`, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })
}

function extractJobIdFromReceipt(logs: readonly { address: `0x${string}`; data: Hex; topics: readonly Hex[] }[]): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== AGENTIC_COMMERCE.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: agenticCommerceAbi,
        data: log.data,
        topics: log.topics as [signature: Hex, ...Hex[]],
      })
      if (decoded.eventName === 'JobCreated') {
        return decoded.args.jobId
      }
    } catch {
      /* skip non-matching log */
    }
  }
  return null
}

export const ERC8183_CONTRACT = AGENTIC_COMMERCE
export const USDC_CONTRACT = USDC_ADDRESS

// ─── Plan A: user-as-client, admin-as-provider+evaluator ──────────────
// Below this line is the new flow where the user's Privy embedded wallet
// signs createJob/approve/fund and the platform admin signs setBudget/submit/
// complete. Plan A flag is independent from ERC8183_ENABLED; both must be on
// for the new flow to actually run.
export const ERC8183_USER_CLIENT = process.env.ERC8183_USER_CLIENT === '1'

export interface PreparedClientTx {
  to: `0x${string}`
  data: Hex
  description: string
}

export interface PreparedClientTxBundle {
  // User signs createJob, optionally approve, then fund.
  // setBudget runs server-side AFTER createJob confirms (provider role).
  createJob: PreparedClientTx
  approve: PreparedClientTx | null
  approvalRequired: boolean
  approvalAmount: string
  allowance: string
  // Echoed back so the confirm endpoint can re-derive without trusting client
  budget: string         // wei (uint256 string)
  budgetUsdc: string     // human (e.g. "0.05")
  expiredAt: string      // unix seconds
  description: string
  contract: `0x${string}`
  usdcContract: `0x${string}`
  provider: `0x${string}`
  evaluator: `0x${string}`
  hook: `0x${string}`
}

/**
 * Build the client-side calldata the user's Privy wallet must sign to open + fund
 * an ERC-8183 job. Critically, `fund()` calldata is intentionally not returned
 * here because it needs the jobId emitted by createJob and must run after the
 * provider has called `setBudget()`.
 * The flow is:
 *
 *   1. user signs createJob → returns tx hash
 *   2. user signs approve   → returns tx hash
 *   3. backend admin signs setBudget (after extracting jobId from #1)
 *   4. backend returns fund(jobId) calldata
 *   5. user signs fund      → returns tx hash
 *
 * To avoid 2 separate frontend round-trips, the recommended UX is:
 *   - user submits all 3 sigs back-to-back (steps 1, 2, 4 from their POV)
 *   - backend's confirm endpoint sequences them: receives createJob hash first,
 *     fires setBudget, then expects approve+fund hashes.
 *
 * For now the simpler implementation is: user signs createJob alone, frontend
 * waits for post-create to fire setBudget, then user signs approve and fund.
 * That's 3 wallet confirmations for the user.
 */
export async function prepareOpenAndFund(args: {
  clientAddress: `0x${string}`
  description: string
  budgetUsdc?: string
  expirySeconds?: number
}): Promise<PreparedClientTxBundle | null> {
  if (!ERC8183_USER_CLIENT || !adminAccount) return null

  const me = adminAccount.address // admin = provider AND evaluator (Plan A)
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + (args.expirySeconds ?? 24 * 3600))
  const budget = parseUnits(args.budgetUsdc ?? '0.05', USDC_DECIMALS)
  const hook = '0x0000000000000000000000000000000000000000'
  const allowance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [getAddress(args.clientAddress), AGENTIC_COMMERCE],
  })
  const approvalRequired = allowance < budget

  return {
    createJob: {
      to: AGENTIC_COMMERCE,
      data: encodeCreateJob(me, me, expiredAt, args.description),
      description: 'Create ERC-8183 job (open state)',
    },
    approve: approvalRequired
      ? {
          to: USDC_ADDRESS,
          data: encodeApprove(AGENTIC_COMMERCE, MAX_UINT256),
          description: 'Approve ERC-8183 escrow spending',
        }
      : null,
    approvalRequired,
    approvalAmount: MAX_UINT256.toString(),
    allowance: allowance.toString(),
    budget: budget.toString(),
    budgetUsdc: args.budgetUsdc ?? '0.05',
    expiredAt: expiredAt.toString(),
    description: args.description,
    contract: AGENTIC_COMMERCE,
    usdcContract: USDC_ADDRESS,
    provider: me,
    evaluator: me,
    hook,
  }
}

/**
 * Frontend calls this with the jobId extracted from the createJob receipt to
 * get the exact fund() calldata. Server-only because it has to match the ABI
 * exactly — frontend should NOT hand-roll encodeFunctionData lest a typo
 * cause a revert.
 */
export function encodeFundForJob(jobId: bigint): Hex {
  return encodeFund(jobId)
}

/**
 * Admin (provider role) signs setBudget after the user's createJob lands.
 * Extracts the jobId from the user-provided tx hash, verifies it really came
 * from clientAddress, then sends setBudget. Returns the jobId + setBudget tx.
 */
export async function setBudgetByAdmin(args: {
  createJobTxHash: Hex
  expectedClient: `0x${string}`
  budget: bigint
}): Promise<{ jobId: bigint; setBudgetTx: Hex }> {
  if (!adminAccount) throw new Error('ADMIN_PRIVATE_KEY not configured')

  const receipt = await pollingClient.waitForTransactionReceipt({
    hash: args.createJobTxHash,
    confirmations: 1,
    timeout: 180_000,
    pollingInterval: 3_000,
  })
  if (receipt.status !== 'success') {
    throw new Error(`createJob tx ${args.createJobTxHash} reverted`)
  }

  const jobId = extractJobIdFromReceipt(receipt.logs)
  if (!jobId) throw new Error('JobCreated event missing from createJob receipt')

  // Verify msg.sender of createJob matches expected client.
  const tx = await publicClient.getTransaction({ hash: args.createJobTxHash })
  if (tx.from.toLowerCase() !== args.expectedClient.toLowerCase()) {
    throw new Error(`createJob signer mismatch: ${tx.from} != ${args.expectedClient}`)
  }

  // Admin sends setBudget (provider role per Arc reference impl convention).
  const setBudgetData = encodeSetBudget(jobId, args.budget)
  const setBudgetTx = await adminSend(AGENTIC_COMMERCE, setBudgetData)

  return { jobId, setBudgetTx: setBudgetTx.hash }
}

/**
 * Verify user-signed approve + fund tx hashes — confirm both succeeded and
 * came from expectedClient, and that the fund tx targeted the expected jobId.
 */
export async function verifyApproveAndFund(args: {
  approveTxHash: Hex
  fundTxHash: Hex
  expectedClient: `0x${string}`
  expectedJobId: bigint
}): Promise<void> {
  const expected = args.expectedClient.toLowerCase()
  const job = await publicClient.readContract({
    address: AGENTIC_COMMERCE,
    abi: agenticCommerceAbi,
    functionName: 'getJob',
    args: [args.expectedJobId],
  })

  if (args.approveTxHash !== '0x0') {
    const approveTx = await verifyUserTx({
      label: 'approve',
      hash: args.approveTxHash,
      expectedFrom: expected,
      expectedClient: args.expectedClient,
    })
    if (approveTx.to?.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
      throw new Error(`approve tx target mismatch: ${approveTx.to} != ${USDC_ADDRESS}`)
    }
    const approveCall = decodeFunctionData({ abi: erc20Abi, data: approveTx.input })
    if (approveCall.functionName !== 'approve') {
      throw new Error(`approve tx function mismatch: ${approveCall.functionName}`)
    }
    const [spender, amount] = approveCall.args
    if (spender.toLowerCase() !== AGENTIC_COMMERCE.toLowerCase()) {
      throw new Error(`approve spender mismatch: ${spender} != ${AGENTIC_COMMERCE}`)
    }
    if (amount < job.budget) {
      throw new Error(`approve amount ${amount} below job budget ${job.budget}`)
    }
  }

  const fundTx = await verifyUserTx({
    label: 'fund',
    hash: args.fundTxHash,
    expectedFrom: expected,
    expectedClient: args.expectedClient,
  })
  if (fundTx.to?.toLowerCase() !== AGENTIC_COMMERCE.toLowerCase()) {
    throw new Error(`fund tx target mismatch: ${fundTx.to} != ${AGENTIC_COMMERCE}`)
  }
  const fundCall = decodeFunctionData({ abi: agenticCommerceAbi, data: fundTx.input })
  if (fundCall.functionName !== 'fund') {
    throw new Error(`fund tx function mismatch: ${fundCall.functionName}`)
  }
  if (fundCall.args[0] !== args.expectedJobId) {
    throw new Error(`fund jobId mismatch: ${fundCall.args[0]} != ${args.expectedJobId}`)
  }
}

async function verifyUserTx(args: {
  label: string
  hash: Hex
  expectedFrom: string
  expectedClient: `0x${string}`
}) {
  const receipt = await pollingClient.waitForTransactionReceipt({
    hash: args.hash,
    confirmations: 1,
    timeout: 180_000,
    pollingInterval: 3_000,
  })
  if (receipt.status !== 'success') {
    throw new Error(`${args.label} tx ${args.hash} reverted`)
  }
  const tx = await publicClient.getTransaction({ hash: args.hash })
  if (tx.from.toLowerCase() !== args.expectedFrom) {
    throw new Error(`${args.label} tx signer mismatch: ${tx.from} != ${args.expectedClient}`)
  }
  return tx
}
