import { and, eq } from 'drizzle-orm'
import { after } from 'next/server'
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

  // `queued` used to short-circuit here on the theory that a standalone
  // worker would pick it up. It doesn't — no such worker runs in this
  // deployment — and since workflow creation now returns the id before
  // planning finishes (see prepareWorkflow in app/api/workflow/route.ts),
  // `queued` is no longer a fleeting state: it persists for however long
  // LLM planning takes, 8-22s measured. The console's auto-dispatch fires
  // the instant nodes appear, which is well within that window, so it was
  // calling this endpoint while status was still 'queued' — hitting this
  // no-op branch every time and never scheduling the fallback below. The
  // workflow sat funded and planned forever with nothing to ever run it.
  //
  // The CAS below (`WHERE status = 'queued'`) already makes double-firing
  // safe — a second call here just fails to claim and does nothing — so
  // there is nothing to protect by returning early for 'queued'.
  if (wf.status === 'completed' || wf.status === 'running' || wf.status === 'settling') {
    return new Response(JSON.stringify({ ok: true, status: wf.status, message: 'Workflow already running or completed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Mark the workflow as queued for the worker
  await db
    .update(workflows)
    .set({ status: 'queued' })
    .where(eq(workflows.id, workflowId))

  // Non-blocking execution fallback in case standalone worker process isn't
  // running.
  //
  // This used to be `setTimeout(fn, 100)`. On a persistent process (the
  // local dev server) that works — the Node process just keeps running.
  // On Vercel, a serverless function's execution environment is frozen the
  // moment the response finishes sending; a freshly-scheduled `setTimeout`
  // callback needs the event loop to advance 100ms AFTER that point, which
  // is precisely the window the platform reclaims. It never fires. This is
  // exactly why runs on gigawork.xyz got past the queued-race fix, showed
  // escrow funded on-chain, then produced nothing — dispatch reported
  // success and the timer that would have actually run it was discarded
  // with the frozen container.
  //
  // `after()` is Next's supported answer to this: on Vercel it registers
  // the callback with the platform's `waitUntil`, which keeps the
  // invocation alive (up to `maxDuration`) until the promise settles,
  // instead of racing a timer against a container freeze.
  after(async () => {
    try {
      const { executeWorkflowRun } = await import('@/lib/workflow/executor')
      const [claimed] = await db
        .update(workflows)
        .set({ status: 'running' })
        .where(and(eq(workflows.id, workflowId), eq(workflows.status, 'queued')))
        .returning()
      if (claimed) {
        await executeWorkflowRun({ workflowId: claimed.id, userId: claimed.userId })
      }
    } catch (err) {
      console.error('[execute] Background execution error:', err)
    }
  })

  return new Response(JSON.stringify({ ok: true, message: 'Workflow queued for execution' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
