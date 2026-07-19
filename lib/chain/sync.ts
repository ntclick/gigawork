import { db } from '@/lib/db/client'
import { agents, jobs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getReputationScore } from '@/lib/arc/reputation'
import { getOnchainJobDetails } from '@/lib/arc/job'
import { updateAgentReputation } from '@/lib/supabase/agents'
import { updateJobStatus } from '@/lib/supabase/jobs'

/**
 * Syncs the agent's database reputation score cache with the current on-chain state.
 */
export async function syncAgentReputationScore(agentId: string): Promise<string> {
  const [agent] = await db
    .select({ onchainId: agents.onchainId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1)

  if (!agent || !agent.onchainId) {
    return '0'
  }

  try {
    const score = await getReputationScore(agent.onchainId.toString())
    await updateAgentReputation(agentId, score.toString())
    console.log(`[sync] Agent ${agentId} reputation score synced: ${score}`)
    return score.toString()
  } catch (err) {
    console.error(`[sync] Failed to sync reputation score for agent ${agentId}:`, err)
    return '0'
  }
}

/**
 * Reconciles the database escrow job status with the current on-chain ERC-8183 status.
 */
export async function syncJobEscrowStatus(jobId: string): Promise<string | null> {
  const [job] = await db
    .select({ onchainJobId: jobs.onchainJobId })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1)

  if (!job || !job.onchainJobId) {
    return null
  }

  try {
    const details = await getOnchainJobDetails(job.onchainJobId.toString())
    
    // Map status integer (0: Open, 1: Funded, 2: Submitted, 3: Completed)
    let status = 'Open'
    if (details.status === 1) status = 'Funded'
    else if (details.status === 2) status = 'Submitted'
    else if (details.status === 3) status = 'Completed'

    await updateJobStatus(jobId, status)
    console.log(`[sync] Job ${jobId} escrow status synced on-chain: ${status}`)
    return status
  } catch (err) {
    console.error(`[sync] Failed to sync escrow status for job ${jobId}:`, err)
    return null
  }
}
