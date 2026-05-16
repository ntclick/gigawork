import { createPublicClient, createWalletClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Chain definition lives in lib/chain/arcTestnet.ts so client components
// (browser bundle) can import it without dragging in the admin wallet /
// ADMIN_PRIVATE_KEY logic from this file.
export { arcTestnet } from './arcTestnet'
import { arcTestnet } from './arcTestnet'

const RPC_URL = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC
const PK = process.env.ADMIN_PRIVATE_KEY

if (!RPC_URL) throw new Error('ARC_RPC_URL missing')

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(RPC_URL, { batch: true }),
})

// Non-batch client for waitForTransactionReceipt — batch transport
// can return stale/cached results on Alchemy testnet RPCs, causing
// receipt waits to hang even after the tx confirms on-chain.
export const pollingClient = createPublicClient({
  chain: arcTestnet,
  transport: http(RPC_URL, { batch: false }),
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
