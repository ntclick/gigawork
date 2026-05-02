import { decodeEventLog, parseAbi, type Hex } from 'viem'

import { adminWallet, publicClient } from './client'

const IDENTITY_REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS ?? '') as `0x${string}`
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

const identityAbi = parseAbi([
  'function register(string agentURI) external returns (uint256 agentId)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
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

/**
 * Calls IdentityRegistry.register(agentURI) using the admin wallet. The
 * registered NFT is owned by the admin since msg.sender = admin — v2 uses
 * a custodial pattern where we issue a token id per user but the on-chain
 * owner is the platform admin. v3 will switch to having Privy embedded
 * wallets call register() directly so users own their NFT outright.
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
