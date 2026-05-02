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
import { decodeEventLog, getAddress, keccak256, parseAbi, parseUnits, toHex, type Hex } from 'viem'

import { adminAccount, adminWallet, publicClient } from './client'

const AGENTIC_COMMERCE = (process.env.AGENTIC_COMMERCE_ADDRESS ??
  '0x0747EEf0706327138c69792bF28Cd525089e4583') as `0x${string}`

const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as `0x${string}`
const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')

export const ERC8183_ENABLED = process.env.ERC8183_ENABLED === '1'

const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
])

const agenticCommerceAbi = [
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
  submitTx: Hex
  completeTx: Hex
  deliverableHash: Hex
  reasonHash: Hex
}

/**
 * Send a tx from the admin wallet and wait for 1 confirmation.
 * Throws on revert. Returns the tx hash + receipt.
 */
async function adminSend(to: `0x${string}`, data: Hex): Promise<{ hash: Hex; receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>> }> {
  if (!adminWallet || !adminAccount) {
    throw new Error('admin wallet not configured (ADMIN_PRIVATE_KEY missing)')
  }
  const hash = await adminWallet.sendTransaction({ to, data })
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 60_000,
  })
  if (receipt.status !== 'success') {
    throw new Error(`tx ${hash} reverted`)
  }
  return { hash, receipt }
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

  // Step 2 — setBudget
  const setBudgetData = encodeSetBudget(jobId, budget)
  const setBudget = await adminSend(AGENTIC_COMMERCE, setBudgetData)

  // Step 3 — approve USDC
  const approveData = encodeApprove(AGENTIC_COMMERCE, budget)
  const approve = await adminSend(USDC_ADDRESS, approveData)

  // Step 4 — fund escrow → status: Funded
  const fundData = encodeFund(jobId)
  const fund = await adminSend(AGENTIC_COMMERCE, fundData)

  return {
    jobId: jobId.toString(),
    createTx: create.hash,
    setBudgetTx: setBudget.hash,
    approveTx: approve.hash,
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

  const submit = await adminSend(AGENTIC_COMMERCE, encodeSubmit(jobId, deliverableHash))
  const complete = await adminSend(AGENTIC_COMMERCE, encodeComplete(jobId, reasonHash))

  return {
    submitTx: submit.hash,
    completeTx: complete.hash,
    deliverableHash,
    reasonHash,
  }
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
