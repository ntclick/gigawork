import { and, eq } from 'drizzle-orm'
import { type UIMessage } from 'ai'

import { streamBrain } from '@/lib/ai/brain'
import { getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { workflows } from '@/lib/db/schema'

export const maxDuration = 120

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
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

  const result = await streamBrain({ workflowId: id, userId: user.id, uiMessages })
  return result.toUIMessageStreamResponse()
}
