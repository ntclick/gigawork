import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { workflows, nodes, skills, workflowEvents } from '@/lib/db/schema'
import { buildWorkflowViewState } from '@/lib/workflow/view-state'
import { readJobStatus } from '@/lib/chain/agenticCommerce'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params

  let u
  try {
    u = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  const [wf] = await withDbRetry(
    () => db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, u.id)))
      .limit(1),
    { label: 'workflow-view-state:wf' },
  )

  if (!wf) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Non-blocking Self-heal in background (does not block HTTP response)
  if (wf.erc8183JobId && !wf.erc8183CompleteTx && wf.erc8183FundTx && wf.status !== 'completed') {
    setTimeout(async () => {
      try {
        const jobId = BigInt(wf.erc8183JobId!)
        const onChainStatus = await Promise.race([
          readJobStatus(jobId),
          new Promise<number>((r) => setTimeout(() => r(-1), 800)),
        ])
        if (onChainStatus === 3) {
          await db.update(workflows).set({ status: 'completed' }).where(eq(workflows.id, id))
        }
      } catch {}
    }, 0)
  }

  const [steps, agents, events] = await Promise.all([
    withDbRetry(
      () => db
        .select()
        .from(nodes)
        .where(eq(nodes.workflowId, id))
        .orderBy(asc(nodes.createdAt)),
      { label: 'workflow-view-state:steps' }
    ),
    withDbRetry(
      () => db.select().from(skills),
      { label: 'workflow-view-state:agents' }
    ),
    withDbRetry(
      () => db
        .select()
        .from(workflowEvents)
        .where(eq(workflowEvents.workflowId, id))
        .orderBy(asc(workflowEvents.createdAt)),
      { label: 'workflow-view-state:events' }
    ),
  ])

  const viewState = buildWorkflowViewState(wf, steps, [], agents, events, {
    identityTokenId: u.identityTokenId ?? null,
    reputationScore: u.reputationScore ?? null,
  })

  return NextResponse.json(viewState)
}
