import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'

import { getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { messages, workflows } from '@/lib/db/schema'

type RouteCtx = { params: Promise<{ id: string }> }

type ToolPart = {
  type: string
  toolCallId: string
  state: 'output-available'
  input: unknown
  output: unknown
}

type TextPart = { type: 'text'; text: string }

type UIMessageOut = {
  id: string
  role: 'user' | 'assistant'
  parts: (ToolPart | TextPart)[]
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params

  const u = await getCurrentUser()
  const [wf] = await withDbRetry(
    () => db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, u.id)))
      .limit(1),
    { label: 'workflow-messages:wf' },
  )
  if (!wf) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const rows = await withDbRetry(
    () => db
      .select()
      .from(messages)
      .where(eq(messages.workflowId, id))
      .orderBy(asc(messages.createdAt)),
    { label: 'workflow-messages:rows' },
  )

  const out: UIMessageOut[] = []

  // First user bubble = workflow.prompt (the seed insert in /api/workflow lives
  // here, but we always synthesize from wf.prompt to be safe).
  out.push({
    id: 'u-seed',
    role: 'user',
    parts: [{ type: 'text', text: wf.prompt }],
  })

  // Assistant message bundles every tool/text artifact in chronological order.
  const assistantParts: (ToolPart | TextPart)[] = []
  for (const m of rows) {
    if (m.role === 'user') continue // already seeded above
    if (m.role === 'system' && m.toolName) {
      const payload = (m.toolPayload as { input?: unknown; output?: unknown; skill_name?: string; output_data?: unknown } | null) ?? {}
      let input: unknown
      let output: unknown
      if (m.toolName === 'planWorkflow') {
        input = payload.input
        output = payload.output
      } else if (m.toolName === 'dispatchSkill') {
        const p = payload as {
          skill_name?: string
          input?: unknown
          output?: unknown
          dispatch_tx?: string | null
        }
        input = { skill_name: p.skill_name, input: p.input, node_id: m.nodeId }
        output = {
          ok: true,
          node_id: m.nodeId,
          skill_name: p.skill_name,
          output: p.output,
          dispatch_tx: p.dispatch_tx ?? null,
        }
      } else {
        input = payload
        output = payload
      }
      assistantParts.push({
        type: `tool-${m.toolName}`,
        toolCallId: m.id,
        state: 'output-available',
        input,
        output,
      })
      continue
    }
    if (m.role === 'brain' && m.content) {
      assistantParts.push({ type: 'text', text: m.content })
      continue
    }
  }

  if (assistantParts.length > 0) {
    out.push({ id: 'a-history', role: 'assistant', parts: assistantParts })
  }

  return NextResponse.json({
    workflow: { id: wf.id, prompt: wf.prompt, status: wf.status, createdAt: wf.createdAt },
    messages: out,
    isFinished: wf.status === 'completed' || wf.status === 'failed' || wf.status === 'refused',
  })
}
