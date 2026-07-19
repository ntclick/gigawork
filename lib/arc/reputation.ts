import { encodeFunctionData, parseAbi, type Hex } from 'viem'
import { REPUTATION_REGISTRY } from '@/contracts/addresses'
import { publicClient } from '../chain/client'
import { sendAdminTransaction } from '../chain/client'
import { sendAgentTransaction } from '../circle/wallet'

const reputationAbi = parseAbi([
  'function increment(uint256 tokenId) external',
  'function incrementBatch(uint256[] tokenIds) external',
  'function getScore(uint256 tokenId) external view returns (uint256)',
  'function giveFeedback(uint256 tokenId, uint8 rating, string comment) external',
  'event ScoreIncremented(uint256 indexed tokenId, uint256 newScore)',
  'event FeedbackGiven(uint256 indexed tokenId, uint8 rating, string comment, address indexed author)',
])

/**
 * Increment reputation score for a single agent on-chain using the admin account.
 */
export async function incrementReputation(tokenId: string): Promise<Hex | null> {
  if (!REPUTATION_REGISTRY) return null

  const data = encodeFunctionData({
    abi: reputationAbi,
    functionName: 'increment',
    args: [BigInt(tokenId)],
  })

  try {
    const hash = await sendAdminTransaction({
      to: REPUTATION_REGISTRY as `0x${string}`,
      data,
    })

    await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 30_000,
    })

    return hash
  } catch (err) {
    console.warn(`[reputation] increment failed for tokenId ${tokenId}:`, err)
    return null
  }
}

/**
 * Increment reputation scores for a batch of tokenIds on-chain.
 */
export async function incrementReputationBatch(tokenIds: string[]): Promise<Hex | null> {
  if (!REPUTATION_REGISTRY || tokenIds.length === 0) return null

  const data = encodeFunctionData({
    abi: reputationAbi,
    functionName: 'incrementBatch',
    args: [tokenIds.map((id) => BigInt(id))],
  })

  try {
    const hash = await sendAdminTransaction({
      to: REPUTATION_REGISTRY as `0x${string}`,
      data,
    })

    await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 30_000,
    })

    return hash
  } catch (err) {
    console.warn(`[reputation] incrementBatch failed:`, err)
    return null
  }
}

/**
 * Submits structured rating and feedback on-chain, signed by the reviewer agent's wallet.
 */
export async function giveFeedback(
  reviewerPrivateKey: string,
  targetTokenId: string,
  rating: number, // uint8 (e.g. 1-5 or 1-100)
  comment: string
): Promise<Hex | null> {
  if (!REPUTATION_REGISTRY) return null

  const data = encodeFunctionData({
    abi: reputationAbi,
    functionName: 'giveFeedback',
    args: [BigInt(targetTokenId), rating, comment],
  })

  try {
    const hash = await sendAgentTransaction(reviewerPrivateKey, {
      to: REPUTATION_REGISTRY as `0x${string}`,
      data,
    })

    await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 30_000,
    })

    return hash
  } catch (err) {
    console.warn(`[reputation] giveFeedback failed for target ${targetTokenId}:`, err)
    return null
  }
}

/**
 * Reads the cumulative score of an agent.
 */
export async function getReputationScore(tokenId: string): Promise<number> {
  if (!REPUTATION_REGISTRY) return 0

  try {
    const score = await publicClient.readContract({
      address: REPUTATION_REGISTRY as `0x${string}`,
      abi: reputationAbi,
      functionName: 'getScore',
      args: [BigInt(tokenId)],
    })
    return Number(score)
  } catch {
    // If method doesn't exist on older mock contracts, fail gracefully
    return 0
  }
}
