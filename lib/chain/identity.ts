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
 * Check if the given wallet owns any Identity NFT on-chain.
 * Useful for syncing identities minted via external clients (not this frontend).
 */
export async function checkOnChainIdentity(wallet: string): Promise<string | null> {
  if (!IDENTITY_REGISTRY) return null
  try {
    const balance = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: identityAbi,
      functionName: 'balanceOf',
      args: [getAddress(wallet)],
    })
    
    if (balance > BigInt(0)) {
      const tokenId = await publicClient.readContract({
        address: IDENTITY_REGISTRY,
        abi: identityAbi,
        functionName: 'tokenOfOwnerByIndex',
        args: [getAddress(wallet), BigInt(0)],
      })
      return tokenId.toString()
    }
  } catch (err) {
    console.warn(`[checkOnChainIdentity] failed for ${wallet}:`, err instanceof Error ? err.message : String(err))
  }
  return null
}

