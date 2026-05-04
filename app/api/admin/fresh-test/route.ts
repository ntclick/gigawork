/**
 * /api/admin/fresh-test — create a brand-new workflow with the given prompt,
 * run streamBrain server-side, drain the stream, then return the full
 * end-state (workflow row + messages + nodes). Lets us iterate the brain
 * pipeline without dragging in any prior state.
 */
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { streamBrain } from '@/lib/ai/brain'
import { db } from '@/lib/db/client'
import { messages, nodes, users, workflows } from '@/lib/db/schema'
import { getOrCreateUser } from '@/lib/credits/service'

export async function POST(req: Request) {
  const url = new URL(req.url)
  const guard =
    req.headers.get('x-migrate-token') ?? url.searchParams.get('token') ?? ''
  if (guard !== (process.env.MIGRATE_TOKEN ?? 'dev-migrate')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string
    wallet?: string
  }
  const prompt = body.prompt ?? 'Run polymarket-pulse with limit:5 query:"Trump 2028" and compose a brief in casual tone.'
  const wallet = body.wallet ?? '0xcc27053250d23845ab3e91b8738873496e3f4988'

  // Reuse or create a user row
  const user = await getOrCreateUser(wallet.toLowerCase())
  // Pretend identity is set so the brain doesn't trip the gate
  if (!user.identityTokenId) {
    await db
      .update(users)
      .set({ identityTokenId: 'test', identityTxHash: 'test', identityMintedAt: new Date() })
      .where(eq(users.id, user.id))
  }

  // Insert fresh workflow
  const [wf] = await db
    .insert(workflows)
    .values({ prompt, userId: user.id, status: 'planning' })
    .returning()

  await db.insert(messages).values({
    workflowId: wf.id,
    role: 'user',
    content: prompt,
  })

  let streamSummary: Record<string, unknown> = {}
  try {
    const result = await streamBrain({
      workflowId: wf.id,
      userId: user.id,
      uiMessages: [
        { id: 'seed', role: 'user', parts: [{ type: 'text', text: prompt }] },
      ],
    })
    const stream = result.toUIMessageStream()
    const reader = stream.getReader()
    const eventTags: string[] = []
    const t0 = Date.now()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const tag = (value as { type?: string })?.type ?? 'unknown'
      eventTags.push(tag)
      if (Date.now() - t0 > 100_000) break
    }
    streamSummary = {
      duration_ms: Date.now() - t0,
      event_count: eventTags.length,
      unique_tags: Array.from(new Set(eventTags)),
    }
  } catch (e) {
    streamSummary = { error: e instanceof Error ? e.message : String(e) }
  }

  // Read final state
  const finalMessages = await db.select().from(messages).where(eq(messages.workflowId, wf.id))
  const finalNodes = await db.select().from(nodes).where(eq(nodes.workflowId, wf.id))
  const [finalWf] = await db.select().from(workflows).where(eq(workflows.id, wf.id)).limit(1)

  return NextResponse.json({
    workflow_id: wf.id,
    final_status: finalWf?.status,
    stream: streamSummary,
    counts: {
      messages: finalMessages.length,
      nodes: finalNodes.length,
      dispatches: finalMessages.filter((m) => m.toolName === 'dispatchSkill').length,
      plans: finalMessages.filter((m) => m.toolName === 'planWorkflow').length,
      finalizes: finalMessages.filter((m) => m.toolName === 'finalizeReport').length,
    },
    messages: finalMessages.map((m) => ({
      role: m.role,
      tool: m.toolName,
      content_preview: m.content?.slice(0, 200) ?? null,
      payload_preview: m.toolPayload
        ? JSON.stringify(m.toolPayload).slice(0, 300)
        : null,
    })),
    nodes: finalNodes.map((n) => ({
      id: n.id,
      label: n.label,
      status: n.status,
      depends_on: n.dependsOn,
      output_preview: n.output ? JSON.stringify(n.output).slice(0, 200) : null,
    })),
  })
}
