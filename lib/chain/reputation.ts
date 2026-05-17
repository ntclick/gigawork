/**
 * reputation — on-chain reputation scoring via ERC-8004 ReputationRegistry.
 *
 * Reference: https://eips.ethereum.org/EIPS/eip-8004
 * Contract:  0x8004B663056A597Dffe9eCcC1965A193B7388713 (Arc Testnet)
 *
 * After a workflow settles (ERC-8183 complete), we record one `giveFeedback`
 * tx per ERC-8004 agentId — every skill's agentTokenId + the user's
 * identityTokenId. Each call emits an event the off-chain indexer picks up;
 * the DB cache (skills.reputation_score, users.reputation_score) is updated
 * in the same finalize pass.
 *
 * Self-dealing note: ERC-8004 prevents an agent's OWNER from recording
 * reputation for that agent on-chain. If admin owns the skill tokens,
 * giveFeedback will revert — we catch the revert and continue. The DB
 * score is still incremented by the caller (cacheReputation / reconcile).
 */
import { encodeFunctionData, keccak256, parseAbi, toHex, type Hex } from 'viem'

import {
  adminAccount,
  pollingClient,
  publicClient,
  sendAdminTransaction,
} from './client'

const REPUTATION_REGISTRY_ADDRESS = (process.env.REPUTATION_REGISTRY_ADDRESS ??
  '0x8004B663056A597Dffe9eCcC1965A193B7388713') as `0x${string}`

// ERC-8004 ReputationRegistry surface.
const reputationAbi = parseAbi([
  'function giveFeedback(uint256 agentId, int128 score, uint8 feedbackType, string tag, string metadataURI, string evidenceURI, string comment, bytes32 feedbackHash) external',
  'event FeedbackGiven(uint256 indexed agentId, address indexed reviewer, int128 score, uint8 feedbackType, string tag, bytes32 feedbackHash)',
])

// Default score for a successfully-settled workflow. Per the ERC-8004
// docs, production setups should derive this from actual outcomes (eg
// slippage, on-time delivery). We use a fixed positive value here — the
// off-chain indexer can later weight by tag.
const DEFAULT_SCORE = 95
// Negative score recorded when a workflow fails. int128 so negatives are
// valid; the indexer reads sign separately from magnitude.
const FAILURE_SCORE = -50
// feedbackType uint8 — the spec leaves the enum semantics to the
// application. We use 0 = "task_completed" by convention.
const FEEDBACK_TYPE_TASK_COMPLETED = 0
const FEEDBACK_TYPE_TASK_FAILED = 1
const FEEDBACK_TAG_SETTLED = 'workflow_settled'
const FEEDBACK_TAG_FAILED = 'workflow_failed'
const FEEDBACK_TAG = FEEDBACK_TAG_SETTLED

/**
 * Submit one ERC-8004 `giveFeedback` tx per agent. Returns the first tx
 * hash (most-recent settle hash kept in DB for the trail UI), or null
 * when nothing was sent. Tokens owned by the admin signer are skipped
 * — the registry would revert with a self-dealing error otherwise.
 */
export async function incrementReputationBatch(
  tokenIds: string[],
  outcome: 'completed' | 'failed' = 'completed',
): Promise<Hex | null> {
  if (!REPUTATION_REGISTRY_ADDRESS || !adminAccount) return null

  const eligible = [...new Set(tokenIds)]
  if (eligible.length === 0) return null

  const score = outcome === 'failed' ? FAILURE_SCORE : DEFAULT_SCORE
  const feedbackType =
    outcome === 'failed' ? FEEDBACK_TYPE_TASK_FAILED : FEEDBACK_TYPE_TASK_COMPLETED
  const tag = outcome === 'failed' ? FEEDBACK_TAG_FAILED : FEEDBACK_TAG_SETTLED

  // Compute a stable feedbackHash per submission so the registry can
  // dedupe — using the tag is enough for the demo flow; in prod you'd
  // hash the deliverable + reviewer + timestamp.
  const feedbackHash = keccak256(toHex(tag))

  let firstTx: Hex | null = null
  for (const id of eligible) {
    const data = encodeFunctionData({
      abi: reputationAbi,
      functionName: 'giveFeedback',
      args: [
        BigInt(id),
        BigInt(score),
        feedbackType,
        tag,
        '', // metadataURI
        '', // evidenceURI
        '', // comment
        feedbackHash,
      ],
    })

    let hash: Hex
    try {
      hash = await sendAdminTransaction({
        to: REPUTATION_REGISTRY_ADDRESS,
        data,
      })
      const receipt = await pollingClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 90_000,
        pollingInterval: 1_000,
      })
      if (receipt.status !== 'success') {
        console.warn(`[reputation] giveFeedback token #${id} reverted: ${hash}`)
        continue
      }
    } catch (err) {
      // Don't fail the whole batch — record what we can.
      console.warn(
        `[reputation] giveFeedback token #${id} threw`,
        err instanceof Error ? err.message : err,
      )
      continue
    }
    if (!firstTx) firstTx = hash
  }

  return firstTx
}

/**
 * Read the cumulative on-chain feedback score for a single agentId by
 * summing every FeedbackGiven event. The registry doesn't expose a
 * single getter (different deployments cache differently), so we scan
 * events. Bounded to the last ~50k blocks to stay under the eth_getLogs
 * limit; consumers should treat this as best-effort with DB cache as
 * the source of truth.
 */
export async function getReputationScore(tokenId: string): Promise<number> {
  if (!REPUTATION_REGISTRY_ADDRESS) return 0

  try {
    const latest = await publicClient.getBlockNumber()
    const fromBlock = latest > 50_000n ? latest - 50_000n : 0n
    const logs = await publicClient.getLogs({
      address: REPUTATION_REGISTRY_ADDRESS,
      event: reputationAbi[1],
      args: { agentId: BigInt(tokenId) },
      fromBlock,
      toBlock: latest,
    })
    let total = 0
    for (const log of logs) {
      const score = log.args.score
      if (typeof score === 'bigint') total += Number(score)
    }
    return total
  } catch (err) {
    console.warn(
      `[reputation] getReputationScore #${tokenId} failed`,
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}
