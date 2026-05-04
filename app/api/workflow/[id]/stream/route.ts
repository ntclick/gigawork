import { and, eq } from 'drizzle-orm'
import { type UIMessage } from 'ai'

import { streamBrain } from '@/lib/ai/brain'
import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { messages, workflows } from '@/lib/db/schema'

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
      await db.update(workflows).set({ status: 'failed' }).where(eq(workflows.id, id))
    } catch (dbErr) {
      console.error('[/api/workflow/:id/stream] also failed to persist error', dbErr)
    }
    return new Response(JSON.stringify({ error: 'stream_failed', message: msg.slice(0, 800) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
