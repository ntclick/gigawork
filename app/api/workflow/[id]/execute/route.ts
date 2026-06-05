import { and, eq } from 'drizzle-orm'
import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { workflows } from '@/lib/db/schema'

export const maxDuration = 300 // allow up to 5 minutes for background processing
export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteCtx) {
  const { id: workflowId } = await ctx.params
  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return new Response(JSON.stringify({ error: 'unauthenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw e
  }

  const [wf] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.userId, user.id)))
    .limit(1)

  if (!wf) {
    return new Response(JSON.stringify({ error: 'workflow not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (wf.status === 'completed' || wf.status === 'running' || wf.status === 'settling' || wf.status === 'queued') {
    return new Response(JSON.stringify({ ok: true, status: wf.status, message: 'Workflow already queued, running or completed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Mark the workflow as queued for the worker
  await db
    .update(workflows)
    .set({ status: 'queued' })
    .where(eq(workflows.id, workflowId))

  return new Response(JSON.stringify({ ok: true, message: 'Workflow queued for execution' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
