/**
 * reputation — on-chain reputation scoring via ReputationRegistry.
 *
 * After a workflow settles (ERC-8183 complete), we increment reputation
 * for every skill's agentTokenId + the user's identityTokenId. Scores
 * are stored on-chain in the ReputationRegistry contract and cached in
 * the DB (skills.reputation_score, users.reputation_score).
 *
 * Pattern mirrors agenticCommerce.ts: adminSend, guard on missing env.
 */
import { encodeFunctionData, parseAbi, type Hex } from 'viem'

import { adminAccount, pollingClient, publicClient, sendAdminTransaction } from './client'

const REPUTATION_REGISTRY_ADDRESS = process.env
  .REPUTATION_REGISTRY_ADDRESS as `0x${string}` | undefined

const reputationAbi = parseAbi([
  'function incrementBatch(uint256[] tokenIds)',
  'function getScore(uint256 tokenId) view returns (uint256)',
  'event ScoreIncremented(uint256 indexed tokenId, uint256 newScore)',
])

/**
 * Increment reputation for a batch of ERC-8004 tokenIds (single tx).
 * Deduplicates before sending. Returns the tx hash or null when the
 * registry is not configured / admin wallet is missing.
 */
export async function incrementReputationBatch(
  tokenIds: string[],
): Promise<Hex | null> {
  if (!REPUTATION_REGISTRY_ADDRESS || !adminAccount) {
    return null
  }

  // Deduplicate
  const unique = [...new Set(tokenIds)]
  if (unique.length === 0) return null

  const data = encodeFunctionData({
    abi: reputationAbi,
    functionName: 'incrementBatch',
    args: [unique.map((id) => BigInt(id))],
  })

  const hash = await sendAdminTransaction({
    to: REPUTATION_REGISTRY_ADDRESS,
    data,
  })

  const receipt = await pollingClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
    pollingInterval: 3_000,
  })

  if (receipt.status !== 'success') {
    throw new Error(`reputation incrementBatch tx ${hash} reverted`)
  }

  return hash
}

/**
 * Read the on-chain reputation score for a single tokenId.
 * Returns 0 when the registry is not configured.
 */
export async function getReputationScore(tokenId: string): Promise<number> {
  if (!REPUTATION_REGISTRY_ADDRESS) return 0

  const score = await publicClient.readContract({
    address: REPUTATION_REGISTRY_ADDRESS,
    abi: reputationAbi,
    functionName: 'getScore',
    args: [BigInt(tokenId)],
  })

  return Number(score)
}
