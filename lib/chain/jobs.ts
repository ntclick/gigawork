import { db } from '@/lib/db/client'
import { chainJobs } from '@/lib/db/schema'

export async function enqueueChainJob(args: {
  workflowId: string
  kind: 'erc8183_settle' | 'erc8004_feedback' | 'erc8004_validation' | 'x402_settle'
  idempotencyKey: string
  payload: Record<string, unknown>
}): Promise<void> {
  try {
    await db
      .insert(chainJobs)
      .values({
        workflowId: args.workflowId,
        kind: args.kind,
        idempotencyKey: args.idempotencyKey,
        payload: args.payload,
        status: 'pending',
      })
      .onConflictDoNothing()
  } catch (err) {
    console.error('[jobs] enqueueChainJob failed:', err)
  }
}

export async function enqueueWorkflowSettlementJobs(
  workflowId: string,
  finalMarkdown: string,
  userId: string | null,
) {
  // 1. Enqueue ERC-8183 settlement
  await enqueueChainJob({
    workflowId,
    kind: 'erc8183_settle',
    idempotencyKey: `erc8183_settle:${workflowId}`,
    payload: { finalMarkdown },
  })

  // 2. Enqueue ERC-8004 reputation feedback
  await enqueueChainJob({
    workflowId,
    kind: 'erc8004_feedback',
    idempotencyKey: `erc8004_feedback:${workflowId}`,
    payload: { userId, outcome: 'completed' },
  })
}
