import { NextResponse } from 'next/server'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { workflows, messages } from '@/lib/db/schema'
import {
  getJobDetails,
  claimRefundJob,
  ERC8183_ENABLED,
} from '@/lib/chain/agenticCommerce'
import { publicClient } from '@/lib/chain/client'

export async function POST(req: Request) {
  // Guard the endpoint with the admin/migration token
  const guard =
    req.headers.get('x-cron-token') ??
    req.headers.get('x-migrate-token') ??
    ''
  if (guard !== (process.env.MIGRATE_TOKEN ?? 'dev-migrate')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!ERC8183_ENABLED) {
    return NextResponse.json({
      ok: true,
      message: 'ERC-8183 is disabled in environmental configuration. Cleanup skipped.',
    })
  }

  const processed: Array<{
    workflowId: string
    jobId: string
    action: string
    txHash?: string | null
    detail?: string
  }> = []

  const errors: Array<{
    workflowId: string
    jobId?: string
    error: string
  }> = []

  try {
    // 1. Query workflows in non-terminal states that have an active ERC-8183 jobId
    const activeWorkflows = await db
      .select()
      .from(workflows)
      .where(
        and(
          isNotNull(workflows.erc8183JobId),
          inArray(workflows.status, ['funding', 'running', 'planning', 'settling'])
        )
      )

    console.log(
      `[Escrow Cleanup Cron] Found ${activeWorkflows.length} non-terminal workflows with on-chain jobs to inspect.`
    )

    const nowSeconds = Math.floor(Date.now() / 1000)

    for (const wf of activeWorkflows) {
      const jobId = wf.erc8183JobId!
      try {
        // 2. Fetch the current on-chain details of the job
        const job = await getJobDetails(BigInt(jobId))

        // On-chain status mappings:
        // 0 = Open (created, budget set, not funded)
        // 1 = Funded (USDC in escrow)
        // 2 = Submitted (deliverable hash uploaded)
        // 3 = Completed (settled, funds released)
        
        // CASE A: Job has been completed/settled on-chain but DB failed to update
        if (job.status === 3) {
          await db
            .update(workflows)
            .set({ status: 'completed' })
            .where(eq(workflows.id, wf.id))

          processed.push({
            workflowId: wf.id,
            jobId,
            action: 'self-heal:completed',
            detail: 'On-chain job completed; synchronized local database status to completed.',
          })
          continue
        }

        // CASE B: Job is funded or submitted, but expired on-chain
        if (job.status === 1 || job.status === 2) {
          if (nowSeconds >= job.expiredAt) {
            console.log(
              `[Escrow Cleanup Cron] Job #${jobId} (workflow ${wf.id}) is expired (expiredAt=${job.expiredAt}, now=${nowSeconds}). Initiating refund.`
            )

            // Trigger on-chain claimRefund transaction
            const refundTx = await claimRefundJob(jobId)

            // Update database status to failed/expired and record transaction hashes
            await db
              .update(workflows)
              .set({
                status: 'failed',
                // Keep the existing transaction trail clean
              })
              .where(eq(workflows.id, wf.id))

            // Insert system message about the refund
            await db.insert(messages).values({
              workflowId: wf.id,
              role: 'system',
              content: `[EIP-8183 Escrow Expired] The escrow job #${jobId} expired at ${new Date(
                job.expiredAt * 1000
              ).toISOString()} without successful settlement. An automatic refund transaction has been executed successfully. Refund Tx: ${refundTx}`,
              toolName: 'escrowRefund',
            })

            processed.push({
              workflowId: wf.id,
              jobId,
              action: 'refund',
              txHash: refundTx,
              detail: `USDC escrow refunded successfully because the job expired on-chain.`,
            })
          } else {
            // Funded/Submitted but not expired yet
            processed.push({
              workflowId: wf.id,
              jobId,
              action: 'inspect',
              detail: `Job is funded and active. Expiration in ${job.expiredAt - nowSeconds} seconds.`,
            })
          }
          continue
        }

        // CASE C: Job is created but never funded, and has passed its expiry
        if (job.status === 0) {
          if (nowSeconds >= job.expiredAt) {
            await db
              .update(workflows)
              .set({ status: 'failed' })
              .where(eq(workflows.id, wf.id))

            await db.insert(messages).values({
              workflowId: wf.id,
              role: 'system',
              content: `[EIP-8183 Escrow Unfunded] The job #${jobId} was created but never funded. Since it has now expired, it has been marked as failed.`,
              toolName: 'escrowUnfundedTimeout',
            })

            processed.push({
              workflowId: wf.id,
              jobId,
              action: 'expire-unfunded',
              detail: 'Job was never funded and has expired. Marked database workflow as failed.',
            })
          } else {
            processed.push({
              workflowId: wf.id,
              jobId,
              action: 'inspect',
              detail: 'Job is open but unfunded. Still waiting for funding.',
            })
          }
          continue
        }
      } catch (err: any) {
        console.error(
          `[Escrow Cleanup Cron] Error processing workflow ${wf.id} (job ${jobId}):`,
          err
        )
        errors.push({
          workflowId: wf.id,
          jobId,
          error: err.message || String(err),
        })
      }
    }
  } catch (e: any) {
    console.error('[Escrow Cleanup Cron] Core error:', e)
    return NextResponse.json(
      { ok: false, error: e.message || String(e) },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    processed_count: processed.length,
    error_count: errors.length,
    processed,
    errors,
  })
}
