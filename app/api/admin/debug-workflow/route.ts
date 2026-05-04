/**
 * /api/admin/debug-workflow?id=<uuid>  — admin-only DB inspector for one
 * workflow. Returns the row, all messages (truncated), nodes, and a hint
 * about which step the brain is stuck at.
 *
 * Falls back to the most recent workflow if no id given. Useful when the
 * canvas shows 'Hermes brain is planning…' forever and we need to know
 * whether Kimi actually responded, errored, or never got called.
 */
import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { messages, nodes, workflows } from '@/lib/db/schema'

export async function GET(req: Request) {
  const guard = req.headers.get('x-migrate-token') ?? new URL(req.url).searchParams.get('token') ?? ''
  if (guard !== (process.env.MIGRATE_TOKEN ?? 'dev-migrate')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  let wf
  if (id) {
    const [row] = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1)
    wf = row
  } else {
    const [row] = await db.select().from(workflows).orderBy(desc(workflows.createdAt)).limit(1)
    wf = row
  }
  if (!wf) {
    return NextResponse.json({ error: 'no workflow', hint: 'no workflows exist yet' })
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.workflowId, wf.id))
    .orderBy(messages.createdAt)

  const nds = await db
    .select()
    .from(nodes)
    .where(eq(nodes.workflowId, wf.id))
    .orderBy(nodes.createdAt)

  // Diagnostic: which lifecycle steps fired
  const hasPlan = msgs.some((m) => m.toolName === 'planWorkflow')
  const dispatchCount = msgs.filter((m) => m.toolName === 'dispatchSkill').length
  const hasFinalize = msgs.some(
    (m) => m.toolName === 'finalizeReport' || m.toolName === 'auto_finalize',
  )
  const hasBrainText = msgs.some((m) => m.role === 'brain')

  let stuck_at: string
  if (!hasPlan && !hasBrainText) stuck_at = 'no brain response yet — Kimi may have failed or never streamed'
  else if (!hasPlan && hasBrainText) stuck_at = 'brain responded with plain text but never called planWorkflow'
  else if (hasPlan && dispatchCount === 0) stuck_at = 'plan created but no skill dispatched'
  else if (hasPlan && dispatchCount > 0 && !hasFinalize) stuck_at = `${dispatchCount} skill(s) dispatched, no finalize yet`
  else stuck_at = 'completed'

  return NextResponse.json({
    workflow: {
      id: wf.id,
      user_id: wf.userId,
      prompt: wf.prompt.slice(0, 200),
      status: wf.status,
      created_at: wf.createdAt,
    },
    diagnostic: {
      stuck_at,
      message_count: msgs.length,
      node_count: nds.length,
      has_plan: hasPlan,
      dispatch_count: dispatchCount,
      has_finalize: hasFinalize,
      has_brain_text: hasBrainText,
    },
    env: {
      KIMI_API_KEY: !!process.env.KIMI_API_KEY,
      KIMI_BASE_URL: process.env.KIMI_BASE_URL ?? '(default)',
      KIMI_MODEL: process.env.KIMI_MODEL ?? '(default)',
    },
    messages: msgs.map((m) => ({
      id: m.id,
      role: m.role,
      tool_name: m.toolName,
      content_preview: m.content?.slice(0, 200) ?? null,
      tool_payload_keys: m.toolPayload ? Object.keys(m.toolPayload) : [],
      created_at: m.createdAt,
    })),
    nodes: nds.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      status: n.status,
      depends_on: n.dependsOn,
    })),
  })
}
