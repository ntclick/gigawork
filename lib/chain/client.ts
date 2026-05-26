import { createPublicClient, createWalletClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Chain definition lives in lib/chain/arcTestnet.ts so client components
// (browser bundle) can import it without dragging in the admin wallet /
// ADMIN_PRIVATE_KEY logic from this file.
export { arcTestnet } from './arcTestnet'
import { arcTestnet } from './arcTestnet'

const RPC_URL = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC
const PK = process.env.ADMIN_PRIVATE_KEY
const PROVIDER_PK = process.env.PROVIDER_PRIVATE_KEY ?? PK
const VALIDATOR_PK = process.env.VALIDATOR_PRIVATE_KEY ?? PK

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
export const providerAccount = PROVIDER_PK ? privateKeyToAccount(PROVIDER_PK as `0x${string}`) : null
export const validatorAccount = VALIDATOR_PK ? privateKeyToAccount(VALIDATOR_PK as `0x${string}`) : null

export const adminWallet = adminAccount
  ? createWalletClient({
      account: adminAccount,
      chain: arcTestnet,
      transport: http(RPC_URL, { batch: true }),
    })
  : null

export const providerWallet = providerAccount
  ? createWalletClient({
      account: providerAccount,
      chain: arcTestnet,
      transport: http(RPC_URL, { batch: true }),
    })
  : null

export const validatorWallet = validatorAccount
  ? createWalletClient({
      account: validatorAccount,
      chain: arcTestnet,
      transport: http(RPC_URL, { batch: true }),
    })
  : null

// Address-keyed queues and nonces for absolute thread safety under concurrency
const queuesByAddress: Record<string, Promise<unknown>> = {}
const noncesByAddress: Record<string, number | null> = {}

async function sendTransactionForAccount(
  account: ReturnType<typeof privateKeyToAccount>,
  args: { to: `0x${string}`; data?: Hex; value?: bigint }
): Promise<Hex> {
  const addr = account.address.toLowerCase()
  
  if (!queuesByAddress[addr]) {
    queuesByAddress[addr] = Promise.resolve()
  }

  const run = queuesByAddress[addr].then(async () => {
    const wallet = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(RPC_URL, { batch: true }),
    })

    if (noncesByAddress[addr] === undefined || noncesByAddress[addr] === null) {
      noncesByAddress[addr] = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: 'pending',
      })
    }

    const nonce = noncesByAddress[addr]!
    noncesByAddress[addr] = nonce + 1

    try {
      const hash = await wallet.sendTransaction({ ...args, nonce })
      return hash
    } catch (err) {
      // Reset localNonce on failure so next call re-fetches correct state
      noncesByAddress[addr] = null
      throw err
    }
  })

  queuesByAddress[addr] = run.catch(() => undefined)
  return run
}

export function sendAdminTransaction(args: {
  to: `0x${string}`
  data?: Hex
  value?: bigint
}): Promise<Hex> {
  if (!adminAccount) {
    throw new Error('admin wallet not configured (ADMIN_PRIVATE_KEY missing)')
  }
  return sendTransactionForAccount(adminAccount, args)
}

export function sendProviderTransaction(args: {
  to: `0x${string}`
  data?: Hex
  value?: bigint
}): Promise<Hex> {
  if (!providerAccount) {
    throw new Error('provider wallet not configured (PROVIDER_PRIVATE_KEY missing)')
  }
  return sendTransactionForAccount(providerAccount, args)
}

export function sendValidatorTransaction(args: {
  to: `0x${string}`
  data?: Hex
  value?: bigint
}): Promise<Hex> {
  if (!validatorAccount) {
    throw new Error('validator wallet not configured (VALIDATOR_PRIVATE_KEY missing)')
  }
  return sendTransactionForAccount(validatorAccount, args)
}

export function explorerTxUrl(hash: string): string {
  const base = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
  return `${base}/tx/${hash}`
}

export function explorerAddrUrl(addr: string): string {
  const base = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
  return `${base}/address/${addr}`
}
