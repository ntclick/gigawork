import { NextResponse } from 'next/server'
import { and, desc, eq, isNotNull } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { workflows } from '@/lib/db/schema'

/**
 * GET /api/me/escrows
 *
 * Lists ERC-8183 escrow jobs scoped to the current user's workflows. Used by
 * /finance "Escrows" tab to show every job the user has opened plus its
 * current lifecycle stage. Only workflows that actually opened an on-chain
 * job (erc8183_job_id NOT NULL) are returned — workflows that ran with the
 * feature flag off are omitted.
 *
 * Stage is derived from which tx hashes are populated:
 *   created  → row exists, no setBudget yet
 *   set      → setBudget landed, no approve yet
 *   approved → approve landed, no fund yet
 *   funded   → fund landed, no submit yet
 *   submitted → submit landed, no complete yet
 *   completed → complete landed (terminal)
 */
function deriveStage(wf: typeof workflows.$inferSelect): string {
  if (wf.erc8183CompleteTx) return 'completed'
  if (wf.erc8183SubmitTx) return 'submitted'
  if (wf.erc8183FundTx) return 'funded'
  if (wf.erc8183ApproveTx) return 'approved'
  if (wf.erc8183SetBudgetTx) return 'set'
  return 'created'
}

export async function GET() {
  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  const rows = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.userId, user.id), isNotNull(workflows.erc8183JobId)))
    .orderBy(desc(workflows.createdAt))
    .limit(50)

  const escrows = rows.map((wf) => ({
    workflowId: wf.id,
    prompt: wf.prompt,
    status: wf.status,
    createdAt: wf.createdAt.toISOString(),
    jobId: wf.erc8183JobId!,
    budgetUsdc: wf.erc8183BudgetUsdc,
    createTx: wf.erc8183CreateTx,
    setBudgetTx: wf.erc8183SetBudgetTx,
    approveTx: wf.erc8183ApproveTx,
    fundTx: wf.erc8183FundTx,
    submitTx: wf.erc8183SubmitTx,
    completeTx: wf.erc8183CompleteTx,
    stage: deriveStage(wf),
  }))

  return NextResponse.json({ escrows })
}
