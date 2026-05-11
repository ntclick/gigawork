import { createPublicClient, createWalletClient, defineChain, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC_URL = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID ?? '5042002')
const PK = process.env.ADMIN_PRIVATE_KEY

if (!RPC_URL) throw new Error('ARC_RPC_URL missing')

export const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app',
    },
  },
})

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(RPC_URL, { batch: true }),
})

export const adminAccount = PK ? privateKeyToAccount(PK as `0x${string}`) : null

export const adminWallet = adminAccount
  ? createWalletClient({
      account: adminAccount,
      chain: arcTestnet,
      transport: http(RPC_URL, { batch: true }),
    })
  : null

let adminTxQueue: Promise<unknown> = Promise.resolve()

export function sendAdminTransaction(args: {
  to: `0x${string}`
  data?: Hex
  value?: bigint
}): Promise<Hex> {
  const run = adminTxQueue.then(async () => {
    if (!adminWallet || !adminAccount) {
      throw new Error('admin wallet not configured (ADMIN_PRIVATE_KEY missing)')
    }

    const nonce = await publicClient.getTransactionCount({
      address: adminAccount.address,
      blockTag: 'pending',
    })

    return adminWallet.sendTransaction({ ...args, nonce })
  })

  adminTxQueue = run.catch(() => undefined)
  return run
}

export function explorerTxUrl(hash: string): string {
  const base = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
  return `${base}/tx/${hash}`
}

export function explorerAddrUrl(addr: string): string {
  const base = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
  return `${base}/address/${addr}`
}
