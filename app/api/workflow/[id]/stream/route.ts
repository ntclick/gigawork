import { and, desc, eq } from 'drizzle-orm'
import { type UIMessage } from 'ai'

import { streamBrain } from '@/lib/ai/brain'
import { failWorkflow } from '@/lib/ai/finalizeWorkflow'
import { planWorkflowForPrompt } from '@/lib/ai/simulation'
import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { messages, nodes, workflows } from '@/lib/db/schema'

const STALE_RUNNING_MS = 3 * 60 * 1000

export const maxDuration = 120

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as {
    messages?: UIMessage[]
  }

  const [wf] = await withDbRetry(
    () => db
      .select()
      .from(workflows)
      .where(eq(workflows.id, id))
      .limit(1),
    { label: 'stream:wf-load' },
  )
  if (!wf) {
    return new Response(JSON.stringify({ error: 'workflow not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const userId = wf.userId || 'system-guest'
  const user = { id: userId }

  let status = wf.status
  const isUserRequest = body.messages && body.messages.length > 0
  if (isUserRequest && (status === 'completed' || status === 'failed' || status === 'refused' || status === 'settlement_failed')) {
    // Reset to planning so we can re-stream/re-run when user manually edits a node or sends a message
    await db
      .update(workflows)
      .set({ status: 'planning' })
      .where(eq(workflows.id, id))
    status = 'planning'
  }

  if (status !== 'planning' && status !== 'running') {
    return new Response(
      JSON.stringify({
        error: 'workflow_already_started',
        status: status,
        message: 'This workflow is already running or finished. Use the workflow snapshot instead of starting Hermes again.',
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  if (status === 'running') {
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
          status: status,
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

  const uiMessages = body.messages ?? [
    { id: 'seed', role: 'user' as const, parts: [{ type: 'text' as const, text: wf.prompt }] },
  ]

  const EMPTY_OUTPUT_RE = /model output must contain either output text or tool calls|empty.*output|no.*content.*returned/i
  const MAX_RETRIES = 2

  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await streamBrain({ workflowId: id, userId: user.id, uiMessages, _retry: attempt })
      return result.toUIMessageStreamResponse()
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      if (EMPTY_OUTPUT_RE.test(msg) && attempt < MAX_RETRIES) {
        console.warn(`[stream] empty-output from brain on attempt ${attempt + 1}, retrying...`)
        // Reset workflow status back to planning so the next attempt can claim it
        await db
          .update(workflows)
          .set({ status: 'planning' })
          .where(eq(workflows.id, id))
        // Small pause before retry
        await new Promise((r) => setTimeout(r, 300))
        // Re-claim as running for next attempt
        await db
          .update(workflows)
          .set({ status: 'running' })
          .where(eq(workflows.id, id))
        continue
      }
      break
    }
  }

  const e = lastErr
  const msg = e instanceof Error ? e.message : String(e)
  const isQuotaOrAuthError = /quota|insufficient|balance|suspend|billing|limit|auth|key|unauthorized/i.test(msg)

  if (isQuotaOrAuthError) {
    console.warn(`[stream] LLM API error detected: "${msg}". Activating local planning simulation fallback...`)
    try {
      const simulatedText = await planWorkflowForPrompt({
        workflowId: id,
        userId: user.id,
        prompt: wf.prompt,
      })
      return createMockStreamResponse(simulatedText)
    } catch (simErr) {
      console.error('[stream] Local planning simulation fallback failed', simErr)
    }
  }

  {
    const stack = e instanceof Error ? e.stack?.slice(0, 1500) : undefined
    console.error('[/api/workflow/:id/stream] streamBrain failed after retries', e)
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

function createMockStreamResponse(text: string) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const chunk = `0:${JSON.stringify(text)}\n`
      controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'x-vercel-ai-stream-protocol': 'v1',
    }
  })
}
