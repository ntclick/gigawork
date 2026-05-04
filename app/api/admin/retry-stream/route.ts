/**
 * /api/admin/retry-stream?id=<workflow_uuid> — admin-only trigger to run
 * streamBrain on a specific workflow, bypassing the user-facing auth path.
 * Used to debug "brain never streamed" cases without needing the user to
 * refresh and retry from the UI.
 *
 * The endpoint awaits the FULL stream (not a SSE response), so the result
 * lands in the DB as messages/nodes rows that /api/admin/debug-workflow
 * can show. If streamBrain throws, the catch in the regular stream route
 * already persists a 'stream_error' brain message — but here we also
 * surface the error in the response body for fast iteration.
 */
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { streamBrain } from '@/lib/ai/brain'
import { db } from '@/lib/db/client'
import { workflows } from '@/lib/db/schema'

export async function POST(req: Request) {
  const url = new URL(req.url)
  const guard =
    req.headers.get('x-migrate-token') ?? url.searchParams.get('token') ?? ''
  if (guard !== (process.env.MIGRATE_TOKEN ?? 'dev-migrate')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const id = url.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'missing ?id=<workflow_uuid>' }, { status: 400 })
  }

  const [wf] = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1)
  if (!wf) return NextResponse.json({ error: 'workflow not found' }, { status: 404 })

  try {
    const result = await streamBrain({
      workflowId: id,
      userId: wf.userId,
      uiMessages: [
        {
          id: 'seed',
          role: 'user',
          parts: [{ type: 'text', text: wf.prompt }],
        },
      ],
    })
    // Drain the stream so all tool calls + onFinish fire and get persisted.
    const stream = result.toUIMessageStream()
    const reader = stream.getReader()
    const events: string[] = []
    let totalChars = 0
    const t0 = Date.now()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const tag = (value as { type?: string })?.type ?? 'unknown'
      events.push(tag)
      totalChars += JSON.stringify(value).length
      if (Date.now() - t0 > 90_000) break // safety
    }
    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - t0,
      event_count: events.length,
      event_tags: Array.from(new Set(events)),
      total_chars: totalChars,
    })
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack?.slice(0, 1500) : undefined,
      },
      { status: 500 },
    )
  }
}
