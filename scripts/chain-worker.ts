import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env' })

// DNS Bypass — must run before any DB import
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    'aws-1-ap-south-1.pooler.supabase.com',
    '3.111.225.200'
  )
}

import { eq, and, sql } from 'drizzle-orm'

async function runWorker() {
  console.log('⛓️ GigaWork Chain Worker started. Listening for pending chain jobs...')

  // Dynamic imports AFTER env is loaded — required for dotenv to take effect
  const { db } = await import('../lib/db/client.js')
  const { chainJobs, agents, jobs, workflows } = await import('../lib/db/schema.js')
  const { settleWorkflowJob, cacheReputation, processFailedReputation } = await import('../lib/ai/finalizeWorkflow.js')
  const { syncAgentReputationScore, syncJobEscrowStatus } = await import('../lib/chain/sync.js')

  let lastSyncTime = 0
  const SYNC_INTERVAL_MS = 30_000

  while (true) {
    try {
      // Periodic on-chain status synchronization
      if (Date.now() - lastSyncTime > SYNC_INTERVAL_MS) {
        lastSyncTime = Date.now()
        console.log('[worker] Running periodic on-chain status cache synchronization...')
        try {
          // 1. Sync active provider agents reputation
          const activeAgents = await db
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.agentType, 'provider'), eq(agents.isActive, true)))

          for (const agent of activeAgents) {
            await syncAgentReputationScore(agent.id)
          }

          // 2. Sync active non-completed jobs
          const activeJobs = await db
            .select({ id: jobs.id })
            .from(jobs)
            .where(sql`${jobs.status} not in ('Completed', 'Rejected', 'Expired') and ${jobs.onchainJobId} is not null`)

          for (const job of activeJobs) {
            await syncJobEscrowStatus(job.id)
          }
        } catch (syncErr) {
          console.error('[worker] Periodic cache sync failed:', syncErr)
        }
      }

      // 1. Fetch one pending job
      const [job] = await db
        .select()
        .from(chainJobs)
        .where(eq(chainJobs.status, 'pending'))
        .limit(1)

      if (!job) {
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }

      console.log(`[worker] Processing job ${job.id} (kind: ${job.kind}, workflow: ${job.workflowId})...`)

      // 2. Mark job as running
      await db
        .update(chainJobs)
        .set({ status: 'running', attempts: job.attempts + 1, updatedAt: new Date() })
        .where(eq(chainJobs.id, job.id))

      try {
        const payload = job.payload as Record<string, unknown>

        if (job.kind === 'erc8183_settle') {
          const finalMarkdown = (payload.finalMarkdown as string) || ''
          const [wf] = await db.select({ erc8183JobId: workflows.erc8183JobId }).from(workflows).where(eq(workflows.id, job.workflowId)).limit(1)
          if (wf?.erc8183JobId) {
            const ok = await settleWorkflowJob(job.workflowId, finalMarkdown)
            if (!ok) throw new Error('ERC-8183 settlement function returned false (likely RPC timeout)')
          } else {
            console.log(`[worker] Skipped ERC-8183 settlement: no jobId found for workflow ${job.workflowId}`)
          }
        } else if (job.kind === 'erc8004_feedback') {
          const userId = (payload.userId as string) || null
          const outcome = payload.outcome as 'completed' | 'failed'
          if (outcome === 'completed') {
            await cacheReputation(job.workflowId, userId)
          } else {
            await processFailedReputation(job.workflowId, userId)
          }
        } else {
          throw new Error(`Unknown job kind: ${job.kind}`)
        }

        // Mark completed
        await db
          .update(chainJobs)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(chainJobs.id, job.id))

        console.log(`🟢 Job ${job.id} completed successfully.`)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`❌ Job ${job.id} failed:`, errorMsg)

        // If attempts >= 3, mark as failed permanently. Otherwise, set back to pending for retry.
        const status = job.attempts >= 3 ? 'failed' : 'pending'
        await db
          .update(chainJobs)
          .set({ status, lastError: errorMsg, updatedAt: new Date() })
          .where(eq(chainJobs.id, job.id))

        await new Promise((r) => setTimeout(r, 1000))
      }
    } catch (loopErr) {
      console.error('[worker] Error in worker loop (likely connection error):', loopErr)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}

runWorker().catch((e) => {
  console.error('Fatal chain worker crash:', e)
  process.exit(1)
})
