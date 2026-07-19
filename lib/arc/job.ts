import { decodeEventLog, encodeFunctionData, keccak256, parseUnits, toHex, type Hex } from 'viem'
import { AGENTIC_COMMERCE, USDC_CONTRACT } from '@/contracts/addresses'
import { publicClient } from '../chain/client'
import { sendAgentTransaction, prefundAgentWallet } from '../circle/wallet'

const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')
const MAX_UINT256 = (1n << 256n) - 1n

const erc20Abi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

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

export interface EscrowResult {
  jobId: string
  createTx: Hex
  setBudgetTx: Hex
  approveTx: Hex
  fundTx: Hex
}

/**
 * Creates and funds an ERC-8183 escrow job using the Client Agent's wallet.
 */
export async function createAndFundEscrowJob(args: {
  clientPrivateKey: string
  clientAddress: string
  providerAddress: string
  evaluatorAddress: string
  budgetUsdc: string
  description: string
  expirySeconds?: number
  providerPrivateKey?: string
}): Promise<EscrowResult> {
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + (args.expirySeconds ?? 3600 * 24 * 7)) // 7 days default
  const budget = parseUnits(args.budgetUsdc, USDC_DECIMALS)

  // Ensure client agent has enough gas
  await prefundAgentWallet(args.clientAddress)

  // 1. createJob
  const createData = encodeFunctionData({
    abi: agenticCommerceAbi,
    functionName: 'createJob',
    args: [
      args.providerAddress as `0x${string}`,
      args.evaluatorAddress as `0x${string}`,
      expiredAt,
      args.description,
      '0x0000000000000000000000000000000000000000', // Hook
    ],
  })

  const createTx = await sendAgentTransaction(args.clientPrivateKey, {
    to: AGENTIC_COMMERCE as `0x${string}`,
    data: createData,
  })

  const createReceipt = await publicClient.waitForTransactionReceipt({
    hash: createTx,
    confirmations: 1,
    timeout: 45_000,
  })

  if (createReceipt.status !== 'success') {
    throw new Error(`Escrow job creation reverted: ${createTx}`)
  }

  // Extract jobId
  let jobId: bigint | null = null
  for (const log of createReceipt.logs) {
    if (log.address.toLowerCase() !== AGENTIC_COMMERCE.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: agenticCommerceAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'JobCreated') {
        jobId = decoded.args.jobId
        break
      }
    } catch {
      // ignore
    }
  }

  if (!jobId) {
    throw new Error('JobCreated event not found in transaction receipt')
  }

  // 2 & 3. Approve USDC allowance and Set Budget in parallel
  let approveTx: Hex = '0x0'
  let setBudgetTx: Hex = '0x0'

  const approvePromise = (async () => {
    const allowance = await publicClient.readContract({
      address: USDC_CONTRACT as `0x${string}`,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [args.clientAddress as `0x${string}`, AGENTIC_COMMERCE as `0x${string}`],
    })

    if (allowance < budget) {
      const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [AGENTIC_COMMERCE as `0x${string}`, MAX_UINT256],
      })
      approveTx = await sendAgentTransaction(args.clientPrivateKey, {
        to: USDC_CONTRACT as `0x${string}`,
        data: approveData,
      })
      await publicClient.waitForTransactionReceipt({
        hash: approveTx,
        confirmations: 1,
        timeout: 30_000,
      })
    }
  })()

  const setBudgetPromise = (async () => {
    const setBudgetData = encodeFunctionData({
      abi: agenticCommerceAbi,
      functionName: 'setBudget',
      args: [jobId, budget, '0x'],
    })
    
    if (args.providerPrivateKey) {
      // If provider EOA wallet is available, use it to set the budget
      setBudgetTx = await sendAgentTransaction(args.providerPrivateKey, {
        to: AGENTIC_COMMERCE as `0x${string}`,
        data: setBudgetData,
      })
    } else {
      const { adminAccount: clientAdminAccount, sendAdminTransaction: clientSendAdminTransaction } = await import('../chain/client')
      if (clientAdminAccount && args.evaluatorAddress.toLowerCase() === clientAdminAccount.address.toLowerCase()) {
        setBudgetTx = await clientSendAdminTransaction({
          to: AGENTIC_COMMERCE as `0x${string}`,
          data: setBudgetData,
        })
      } else {
        setBudgetTx = await sendAgentTransaction(args.clientPrivateKey, {
          to: AGENTIC_COMMERCE as `0x${string}`,
          data: setBudgetData,
        })
      }
    }

    await publicClient.waitForTransactionReceipt({
      hash: setBudgetTx,
      confirmations: 1,
      timeout: 30_000,
    })
  })()

  await Promise.all([approvePromise, setBudgetPromise])

  // 4. fund
  const fundData = encodeFunctionData({
    abi: agenticCommerceAbi,
    functionName: 'fund',
    args: [jobId, '0x'],
  })
  const fundTx = await sendAgentTransaction(args.clientPrivateKey, {
    to: AGENTIC_COMMERCE as `0x${string}`,
    data: fundData,
  })
  await publicClient.waitForTransactionReceipt({
    hash: fundTx,
    confirmations: 1,
    timeout: 30_000,
  })

  return {
    jobId: jobId.toString(),
    createTx,
    setBudgetTx,
    approveTx,
    fundTx,
  }
}

/**
 * Submits the job deliverables on-chain using the Provider Agent's wallet.
 */
export async function submitEscrowDeliverable(args: {
  providerPrivateKey: string
  providerAddress: string
  jobId: string
  deliverableSeed: string
}): Promise<Hex> {
  const jobId = BigInt(args.jobId)
  const deliverableHash = keccak256(toHex(args.deliverableSeed))

  await prefundAgentWallet(args.providerAddress)

  const submitData = encodeFunctionData({
    abi: agenticCommerceAbi,
    functionName: 'submit',
    args: [jobId, deliverableHash, '0x'],
  })

  const txHash = await sendAgentTransaction(args.providerPrivateKey, {
    to: AGENTIC_COMMERCE as `0x${string}`,
    data: submitData,
  })

  await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 30_000,
  })

  return txHash
}

/**
 * Completes the escrow job and releases funds using the Evaluator Agent's (or client's) wallet.
 */
export async function completeEscrowJob(args: {
  evaluatorPrivateKey: string
  evaluatorAddress: string
  jobId: string
  reasonSeed: string
}): Promise<Hex> {
  const jobId = BigInt(args.jobId)
  const reasonHash = keccak256(toHex(args.reasonSeed))

  await prefundAgentWallet(args.evaluatorAddress)

  const completeData = encodeFunctionData({
    abi: agenticCommerceAbi,
    functionName: 'complete',
    args: [jobId, reasonHash, '0x'],
  })

  const txHash = await sendAgentTransaction(args.evaluatorPrivateKey, {
    to: AGENTIC_COMMERCE as `0x${string}`,
    data: completeData,
  })

  await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 30_000,
  })

  return txHash
}

/**
 * Reads the status and details of an escrow job from the contract.
 */
export async function getOnchainJobDetails(jobId: string) {
  const job = await publicClient.readContract({
    address: AGENTIC_COMMERCE as `0x${string}`,
    abi: agenticCommerceAbi,
    functionName: 'getJob',
    args: [BigInt(jobId)],
  })

  return {
    id: job.id.toString(),
    client: job.client,
    provider: job.provider,
    evaluator: job.evaluator,
    description: job.description,
    budget: job.budget.toString(),
    expiredAt: Number(job.expiredAt),
    status: Number(job.status), // 0: Open, 1: Funded, 2: Submitted, 3: Completed
    hook: job.hook,
  }
}
