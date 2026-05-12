import 'dotenv/config'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const rpc = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC
const pk = process.env.ADMIN_PRIVATE_KEY as `0x${string}` | undefined

if (!rpc) throw new Error('ARC_RPC_URL missing')
if (!pk) throw new Error('ADMIN_PRIVATE_KEY missing')

const chain = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042002),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app',
    },
  },
  testnet: true,
})

const account = privateKeyToAccount(pk)
const contract = (process.env.AGENTIC_COMMERCE_ADDRESS ??
  '0x0747EEf0706327138c69792bF28Cd525089e4583') as `0x${string}`
const usdc = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as `0x${string}`
const decimals = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? 6)
const budget = parseUnits(process.env.ERC8183_TEST_BUDGET_USDC ?? '0.001', decimals)

const publicClient = createPublicClient({ chain, transport: http(rpc, { batch: false }) })
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpc, { batch: false }),
})

const commerceAbi = parseAbi([
  'function createJob(address provider,address evaluator,uint256 expiredAt,string description,address hook) returns (uint256)',
  'function setBudget(uint256 jobId,uint256 amount,bytes optParams)',
  'function fund(uint256 jobId,bytes optParams)',
  'function getJob(uint256 jobId) view returns ((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook))',
  'event JobCreated(uint256 indexed jobId,address indexed client,address indexed provider,address evaluator,uint256 expiredAt,address hook)',
])

const erc20Abi = parseAbi([
  'function approve(address spender,uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
])

async function wait(hash: `0x${string}`, label: string) {
  console.log(`${label}: ${chain.blockExplorers.default.url}/tx/${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
    pollingInterval: 2_000,
  })
  console.log(`${label} receipt: ${receipt.status} block=${receipt.blockNumber}`)
  if (receipt.status !== 'success') throw new Error(`${label} reverted`)
  return receipt
}

async function main() {
  const before = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })

  console.log('account', account.address)
  console.log('contract', contract)
  console.log('budget', formatUnits(budget, decimals), 'USDC')
  console.log('usdc before', formatUnits(before, decimals))

  const block = await publicClient.getBlock()
  const expiredAt = block.timestamp + 3600n

  const createHash = await walletClient.writeContract({
    address: contract,
    abi: commerceAbi,
    functionName: 'createJob',
    args: [
      account.address,
      account.address,
      expiredAt,
      `GigaWork script ERC-8183 test ${new Date().toISOString()}`,
      '0x0000000000000000000000000000000000000000',
    ],
  })
  const createReceipt = await wait(createHash, 'createJob')

  let jobId: bigint | null = null
  for (const log of createReceipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: commerceAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'JobCreated') jobId = decoded.args.jobId
    } catch {
      /* skip */
    }
  }
  if (jobId == null) throw new Error('JobCreated event missing')
  console.log('jobId', jobId.toString())

  await wait(
    await walletClient.writeContract({
      address: contract,
      abi: commerceAbi,
      functionName: 'setBudget',
      args: [jobId, budget, '0x'],
    }),
    'setBudget',
  )

  await wait(
    await walletClient.writeContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'approve',
      args: [contract, budget],
    }),
    'approve',
  )

  await wait(
    await walletClient.writeContract({
      address: contract,
      abi: commerceAbi,
      functionName: 'fund',
      args: [jobId, '0x'],
    }),
    'fund',
  )

  const job = await publicClient.readContract({
    address: contract,
    abi: commerceAbi,
    functionName: 'getJob',
    args: [jobId],
  })

  console.log('job', {
    id: job.id.toString(),
    client: job.client,
    provider: job.provider,
    evaluator: job.evaluator,
    budget: formatUnits(job.budget, decimals),
    status: Number(job.status),
    hook: job.hook,
  })

  const after = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })
  console.log('usdc after', formatUnits(after, decimals))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
