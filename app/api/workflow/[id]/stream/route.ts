import { and, desc, eq } from 'drizzle-orm'
import { type UIMessage } from 'ai'

import { streamBrain } from '@/lib/ai/brain'
import { failWorkflow } from '@/lib/ai/finalizeWorkflow'
import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { messages, nodes, workflows } from '@/lib/db/schema'

const STALE_RUNNING_MS = 3 * 60 * 1000

export const maxDuration = 120

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
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
  const [wf] = await withDbRetry(
    () => db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, user.id)))
      .limit(1),
    { label: 'stream:wf-load' },
  )
  if (!wf) {
    return new Response(JSON.stringify({ error: 'workflow not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (wf.status !== 'planning' && wf.status !== 'running') {
    return new Response(
      JSON.stringify({
        error: 'workflow_already_started',
        status: wf.status,
        message: 'This workflow is already running or finished. Use the workflow snapshot instead of starting Hermes again.',
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  if (wf.status === 'running') {
    const [latest] = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.workflowId, id))
      .orderBy(desc(messages.createdAt))
      .limit(1)
    const lastActivity = latest?.createdAt?.getTime() ?? wf.createdAt.getTime()
    if (Date.now() - lastActivity < STALE_RUNNING_MS) {
      return new Response(
        JSON.stringify({
          error: 'workflow_already_started',
          status: wf.status,
          message: 'Hermes is actively working on this workflow.',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      )
    }
    console.log(
      `[stream] recovering stale workflow ${id} (running for ${Math.round((Date.now() - lastActivity) / 1000)}s with no activity)`,
    )
    await db.delete(nodes).where(eq(nodes.workflowId, id))
    await db.delete(messages).where(eq(messages.workflowId, id))
    await db
      .update(workflows)
      .set({ status: 'planning' })
      .where(eq(workflows.id, id))
  }

  const claimed = await db
    .update(workflows)
    .set({ status: 'running' })
    .where(and(eq(workflows.id, id), eq(workflows.userId, user.id), eq(workflows.status, 'planning')))
    .returning({ id: workflows.id })

  if (claimed.length === 0) {
    return new Response(
      JSON.stringify({
        error: 'workflow_lock_busy',
        message: 'Hermes is already working on this workflow.',
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    messages?: UIMessage[]
  }
  const uiMessages = body.messages ?? [
    { id: 'seed', role: 'user' as const, parts: [{ type: 'text' as const, text: wf.prompt }] },
  ]

  try {
    const result = await streamBrain({ workflowId: id, userId: user.id, uiMessages })
    return result.toUIMessageStreamResponse()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack?.slice(0, 1500) : undefined
    console.error('[/api/workflow/:id/stream] streamBrain failed', e)
    // Persist the error as a brain message so debug-workflow + the UI
    // surface what blew up instead of an empty 'planning…' placeholder.
    try {
      await db.insert(messages).values({
        workflowId: id,
        role: 'brain',
        content: `❌ Brain failed to start: ${msg.slice(0, 800)}`,
        toolName: 'stream_error',
        toolPayload: { error: msg, stack },
      })
      await failWorkflow(id, user.id)
    } catch (dbErr) {
      console.error('[/api/workflow/:id/stream] also failed to persist error', dbErr)
    }
    return new Response(JSON.stringify({ error: 'stream_failed', message: msg.slice(0, 800) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
