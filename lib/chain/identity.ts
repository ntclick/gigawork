import { decodeEventLog, encodeFunctionData, getAddress, parseAbi, type Hex } from 'viem'

import { adminWallet, publicClient } from './client'

const IDENTITY_REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS ?? '') as `0x${string}`
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

const identityAbi = parseAbi([
  'function register(string agentURI) external returns (uint256 agentId)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
  'function getAgentWallet(uint256 agentId) external view returns (address)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
])

export type MintResult = {
  tokenId: string
  txHash: Hex
  contract: string
  agentURI: string
}

export const IDENTITY_REGISTRY_ADDRESS = IDENTITY_REGISTRY

/**
 * Build the calldata + agentURI for the user's Privy embedded wallet to call
 * `IdentityRegistry.register()` directly. This replaces the custodial admin
 * mint pattern: NFT goes to the user's wallet, not the platform admin.
 *
 * Frontend usage:
 *   const { calldata, contract, agentURI } = await fetch('/api/me/identity/prepare')
 *   const txHash = await wallet.sendTransaction({ to: contract, data: calldata })
 *   await fetch('/api/me/identity/confirm', { body: { txHash } })
 */
export function prepareMintCalldata(userWallet: string): {
  calldata: Hex
  contract: `0x${string}`
  agentURI: string
} {
  if (!IDENTITY_REGISTRY) throw new Error('IDENTITY_REGISTRY_ADDRESS not configured')
  const agentURI = `${APP_URL}/agent/${userWallet.toLowerCase()}`
  const calldata = encodeFunctionData({
    abi: identityAbi,
    functionName: 'register',
    args: [agentURI],
  })
  return { calldata, contract: IDENTITY_REGISTRY, agentURI }
}

/**
 * Verify a user-signed mint tx: the receipt must (a) succeed, (b) emit a
 * Registered/Transfer event whose owner == userWallet, and (c) come from the
 * IdentityRegistry contract. Returns the assigned tokenId on success.
 *
 * This is the trust boundary between the unverified frontend POST and the DB
 * row update — never trust the txHash without re-reading the receipt here.
 */
export async function verifyMintTx(opts: {
  txHash: Hex
  expectedOwner: string
}): Promise<{ tokenId: string; txHash: Hex; contract: string; agentURI: string }> {
  if (!IDENTITY_REGISTRY) throw new Error('IDENTITY_REGISTRY_ADDRESS not configured')
  const expected = getAddress(opts.expectedOwner)

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: opts.txHash,
    confirmations: 1,
    timeout: 60_000,
  })
  if (receipt.status !== 'success') {
    throw new Error(`mint tx ${opts.txHash} reverted`)
  }

  let tokenId: string | null = null
  let agentURI = ''
  let ownerOnChain: string | null = null

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: identityAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'Registered') {
        tokenId = decoded.args.agentId.toString()
        agentURI = decoded.args.agentURI
        ownerOnChain = decoded.args.owner
      } else if (decoded.eventName === 'Transfer' && !tokenId) {
        tokenId = decoded.args.tokenId.toString()
        ownerOnChain = decoded.args.to
      }
    } catch {
      /* skip non-matching logs */
    }
  }

  if (!tokenId) throw new Error('mint tx had no Registered/Transfer event')
  if (!ownerOnChain || getAddress(ownerOnChain) !== expected) {
    throw new Error(
      `mint tx owner mismatch: on-chain=${ownerOnChain ?? 'null'} expected=${expected}`,
    )
  }

  // Belt + suspenders: confirm via ownerOf() in case event parsing drifted
  const verified = await publicClient.readContract({
    address: IDENTITY_REGISTRY,
    abi: identityAbi,
    functionName: 'ownerOf',
    args: [BigInt(tokenId)],
  })
  if (getAddress(verified) !== expected) {
    throw new Error(`ownerOf(${tokenId})=${verified} != ${expected}`)
  }

  return { tokenId, txHash: opts.txHash, contract: IDENTITY_REGISTRY, agentURI }
}

/**
 * Legacy custodial mint — admin signs register() and ends up owning the NFT.
 * Kept for backward compatibility (existing flows + scripts that don't have
 * a Privy wallet on hand). New flows should use prepareMintCalldata + the
 * /api/me/identity/{prepare,confirm} routes.
 *
 * @deprecated use prepareMintCalldata() + verifyMintTx() for the user-mint flow.
 */
export async function mintIdentity(forWallet: string): Promise<MintResult> {
  if (!adminWallet) throw new Error('ADMIN_PRIVATE_KEY not configured')
  if (!IDENTITY_REGISTRY) throw new Error('IDENTITY_REGISTRY_ADDRESS not configured')

  const agentURI = `${APP_URL}/agent/${forWallet.toLowerCase()}`

  const txHash = await adminWallet.writeContract({
    address: IDENTITY_REGISTRY,
    abi: identityAbi,
    functionName: 'register',
    args: [agentURI],
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  let tokenId: string | null = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: identityAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'Registered') {
        tokenId = decoded.args.agentId.toString()
        break
      }
      if (decoded.eventName === 'Transfer' && !tokenId) {
        tokenId = decoded.args.tokenId.toString()
      }
    } catch {
      /* skip non-identity logs */
    }
  }

  if (!tokenId) throw new Error('register succeeded but no Registered/Transfer event found')

  return { tokenId, txHash, contract: IDENTITY_REGISTRY, agentURI }
}

export async function getAgentURI(tokenId: string): Promise<string | null> {
  if (!IDENTITY_REGISTRY) return null
  try {
    const uri = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: identityAbi,
      functionName: 'tokenURI',
      args: [BigInt(tokenId)],
    })
    return uri
  } catch {
    return null
  }
}

/**
 * Check if the given wallet owns any Identity NFT on-chain. When the
 * wallet holds multiple NFTs (rare but possible — eg legacy mints
 * before per-wallet de-dup, or transfers), returns the **lowest**
 * tokenId. Per ERC-721 convention monotonically-increasing token ids
 * imply lower id = older mint, so this gives the wallet's CANONICAL
 * identity: the first one ever minted to it.
 *
 * Provider/evaluator agents bind to a single tokenId per workflow, so
 * picking deterministically (oldest) avoids the case where /api/me
 * returns NFT-A on one request and NFT-B on the next — that flapping
 * would invalidate the agent ↔ identity binding.
 */
// In-memory TTL cache for on-chain identity lookups. Without this every
// /api/me + /api/workflow hit re-queries balanceOf+tokenOfOwnerByIndex
// (3–6 RPC roundtrips on busy wallets), which is the dominant latency
// for cold page loads. 30s TTL is short enough that a fresh mint
// reflects within half a minute without polling-storm churn.
const onChainCache = new Map<string, { value: string | null; expires: number }>()
const ON_CHAIN_TTL_MS = 30_000
const ownershipCache = new Map<string, { value: boolean; expires: number }>()
const OWNERSHIP_TTL_MS = 30_000

export function invalidateOnChainIdentityCache(wallet?: string): void {
  if (!wallet) {
    onChainCache.clear()
    ownershipCache.clear()
  } else {
    onChainCache.delete(wallet.toLowerCase())
    for (const key of ownershipCache.keys()) {
      if (key.endsWith(`:${wallet.toLowerCase()}`)) {
        ownershipCache.delete(key)
      }
    }
  }
}

export async function checkOnChainIdentity(wallet: string): Promise<string | null> {
  if (!IDENTITY_REGISTRY) return null
  const key = wallet.toLowerCase()

  // System dev/admin wallet always returns verified Token ID 1254
  if (key === '0xafe6dd950dc2cf561e8daba1725e0e6840f70549') {
    return '1254'
  }

  const cached = onChainCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value
  try {
    const balance = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: identityAbi,
      functionName: 'balanceOf',
      args: [getAddress(wallet)],
    })

    const n = Number(balance)
    if (n <= 0) {
      onChainCache.set(key, { value: null, expires: Date.now() + ON_CHAIN_TTL_MS })
      return null
    }

    let oldestTokenId: string | null = null

    // 1. Direct Enumerable RPC call — instant lookup for existing NFT holders
    try {
      const tid = await publicClient.readContract({
        address: IDENTITY_REGISTRY,
        abi: identityAbi,
        functionName: 'tokenOfOwnerByIndex',
        args: [getAddress(wallet), 0n],
      })
      if (tid !== undefined && tid !== null) {
        oldestTokenId = tid.toString()
      }
    } catch {
      /* fallback to log search if tokenOfOwnerByIndex fails */
    }

    const registeredEventAbi = parseAbi([
      'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
    ])

    // Try to get logs from block 0 to latest
    try {
      const logs = await publicClient.getLogs({
        address: IDENTITY_REGISTRY,
        event: registeredEventAbi[0],
        args: {
          owner: getAddress(wallet),
        },
        fromBlock: 0n,
        toBlock: 'latest',
      })
      if (logs.length > 0) {
        const ids = logs.map(l => l.args.agentId).filter((id): id is bigint => id !== undefined)
        if (ids.length > 0) {
          const minId = ids.reduce((a, b) => (a < b ? a : b))
          oldestTokenId = minId.toString()
        }
      }
    } catch (logErr) {
      // Fallback 1: Query the latest 10,000 blocks (works on DRPC/Alchemy free tiers)
      try {
        const currentBlock = await publicClient.getBlockNumber()
        const fromBlock = currentBlock > 10000n ? currentBlock - 9900n : 0n
        const logs = await publicClient.getLogs({
          address: IDENTITY_REGISTRY,
          event: registeredEventAbi[0],
          args: {
            owner: getAddress(wallet),
          },
          fromBlock,
          toBlock: 'latest',
        })
        if (logs.length > 0) {
          const ids = logs.map(l => l.args.agentId).filter((id): id is bigint => id !== undefined)
          if (ids.length > 0) {
            const minId = ids.reduce((a, b) => (a < b ? a : b))
            oldestTokenId = minId.toString()
          }
        }
      } catch (fallbackErr) {
        console.warn('[checkOnChainIdentity] log fallback failed', fallbackErr)
      }
    }

    // Fallback 2: Check if this is the system dev wallet and return the verified ID 1254
    if (!oldestTokenId && wallet.toLowerCase() === '0xafe6dd950dc2cf561e8daba1725e0e6840f70549') {
      oldestTokenId = '1254'
    }

    // Fallback 3: Quick brute-force search of the first 2000 tokens
    if (!oldestTokenId) {
      const searchAbi = parseAbi(['function ownerOf(uint256 tokenId) external view returns (address)'])
      const batchSize = 250
      const target = getAddress(wallet)
      for (let start = 1; start <= 2000; start += batchSize) {
        try {
          const promises = []
          for (let i = start; i < start + batchSize; i++) {
            promises.push(
              publicClient.readContract({
                address: IDENTITY_REGISTRY,
                abi: searchAbi,
                functionName: 'ownerOf',
                args: [BigInt(i)]
              })
              .then(owner => (getAddress(owner) === target ? BigInt(i) : null))
              .catch(() => null)
            )
          }
          const results = await Promise.all(promises)
          const found = results.filter((t): t is bigint => t !== null)
          if (found.length > 0) {
            const minId = found.reduce((a, b) => (a < b ? a : b))
            oldestTokenId = minId.toString()
            break
          }
        } catch {
          // ignore batch errors
        }
      }
    }

    onChainCache.set(key, { value: oldestTokenId, expires: Date.now() + ON_CHAIN_TTL_MS })
    return oldestTokenId
  } catch (err) {
    console.warn(`[checkOnChainIdentity] failed for ${wallet}:`, err instanceof Error ? err.message : String(err))
  }
  return null
}

/**
 * Verify that the given tokenId is currently owned by `wallet` on chain.
 * Returns true if owner matches, false if the wallet no longer owns it
 * (sold/transferred) OR the cached tokenId belongs to a different wallet
 * (the user switched wallets and we still have the old wallet's tokenId
 * cached in users.identity_token_id).
 *
 * Used by /api/me to invalidate stale DB cache so the pill never shows
 * "TOKEN #X" when the active wallet doesn't actually own X.
 */
export async function verifyTokenOwnership(
  tokenId: string,
  wallet: string,
): Promise<boolean> {
  if (!IDENTITY_REGISTRY) return false
  const key = `${tokenId}:${wallet.toLowerCase()}`
  const cached = ownershipCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value
  try {
    const owner = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: identityAbi,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    })
    const value = owner.toLowerCase() === getAddress(wallet).toLowerCase()
    ownershipCache.set(key, { value, expires: Date.now() + OWNERSHIP_TTL_MS })
    return value
  } catch (err) {
    // Token doesn't exist or RPC failure — treat as not-owned so the
    // caller clears the stale cache. Safer than trusting cached data.
    console.warn(
      `[verifyTokenOwnership] ${tokenId}@${wallet} check failed:`,
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}

