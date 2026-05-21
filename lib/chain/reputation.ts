/**
 * reputation — on-chain reputation scoring via custom ReputationRegistry.
 *
 * Contract ABI:
 *   - increment(uint256 tokenId)      — operator-only, increments score by 1
 *   - incrementBatch(uint256[] tokenIds) — operator-only, batch increment
 *   - getScore(uint256 tokenId)        — view, returns cumulative score
 *
 * After a workflow completes, we call `incrementBatch` with every skill's
 * agentTokenId + the user's identityTokenId. The DB cache
 * (skills.reputation_score, users.reputation_score) is updated in the
 * same finalize pass by the caller (cacheReputation / reconcile).
 */
import { encodeFunctionData, parseAbi, type Hex } from 'viem'

import {
  adminAccount,
  pollingClient,
  publicClient,
  sendAdminTransaction,
} from './client'

const REPUTATION_REGISTRY_ADDRESS = (process.env.REPUTATION_REGISTRY_ADDRESS ??
  '') as `0x${string}`

// Custom ReputationRegistry ABI (matches contracts/ReputationRegistry.sol)
const reputationAbi = parseAbi([
  'function increment(uint256 tokenId) external',
  'function incrementBatch(uint256[] tokenIds) external',
  'function getScore(uint256 tokenId) external view returns (uint256)',
  'event ScoreIncremented(uint256 indexed tokenId, uint256 newScore)',
])

/**
 * Increment reputation scores for a batch of tokenIds using
 * `incrementBatch`. Returns the tx hash, or null if nothing was sent
 * (registry not configured / admin wallet missing).
 */
export async function incrementReputationBatch(
  tokenIds: string[],
  outcome: 'completed' | 'failed' = 'completed',
  workflowId?: string,
): Promise<Hex | null> {
  if (!REPUTATION_REGISTRY_ADDRESS || !adminAccount) {
    console.warn(
      '[reputation] incrementReputationBatch skipped:',
      !REPUTATION_REGISTRY_ADDRESS ? 'REPUTATION_REGISTRY_ADDRESS not set' : 'adminAccount missing',
      `(registry=${REPUTATION_REGISTRY_ADDRESS}, admin=${adminAccount?.address ?? 'null'})`,
    )
    return null
  }

  // Only increment on successful completion — failed workflows don't
  // earn positive reputation. The contract only has increment (no
  // decrement), so we skip entirely for failures.
  if (outcome === 'failed') {
    console.log('[reputation] skipping on-chain increment for failed workflow')
    return null
  }

  const eligible = [...new Set(tokenIds)]
  if (eligible.length === 0) return null

  console.log(
    `[reputation] incrementBatch: ${eligible.length} tokens, workflow=${workflowId ?? 'unknown'}, registry=${REPUTATION_REGISTRY_ADDRESS}`,
  )

  const data = encodeFunctionData({
    abi: reputationAbi,
    functionName: 'incrementBatch',
    args: [eligible.map((id) => BigInt(id))],
  })

  try {
    const hash = await sendAdminTransaction({
      to: REPUTATION_REGISTRY_ADDRESS,
      data,
    })
    console.log(`[reputation] incrementBatch tx sent: ${hash}`)

    const receipt = await pollingClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 90_000,
      pollingInterval: 1_000,
    })

    if (receipt.status !== 'success') {
      console.warn(`[reputation] incrementBatch reverted: ${hash}`)
      return null
    }

    console.log(`[reputation] incrementBatch confirmed ✓ (${eligible.length} tokens)`)
    return hash
  } catch (err) {
    console.warn(
      '[reputation] incrementBatch threw',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * Read the cumulative on-chain score for a single tokenId.
 */
export async function getReputationScore(tokenId: string): Promise<number> {
  if (!REPUTATION_REGISTRY_ADDRESS) return 0

  try {
    const score = await publicClient.readContract({
      address: REPUTATION_REGISTRY_ADDRESS,
      abi: reputationAbi,
      functionName: 'getScore',
      args: [BigInt(tokenId)],
    })
    return Number(score)
  } catch (err) {
    console.warn(
      `[reputation] getScore #${tokenId} failed`,
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}
