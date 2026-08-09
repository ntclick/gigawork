import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { workflows, messages } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { id: workflowId } = await ctx.params
  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  const [wf] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.userId, user.id)))
    .limit(1)

  if (!wf) {
    return NextResponse.json({ error: 'workflow_not_found' }, { status: 404 })
  }

  try {
    const body = await req.json()
    const { agentSlug, rating, feedback, tags } = body as {
      agentSlug?: string
      rating?: number
      feedback?: string
      tags?: string[]
    }

    if (!agentSlug || typeof rating !== 'number') {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
    }

    // Persist review as an audit message record in the workflow timeline
    await db.insert(messages).values({
      workflowId,
      role: 'system',
      toolPayload: {
        type: 'agent_review',
        agentSlug,
        rating,
        feedback: feedback ?? '',
        tags: tags ?? [],
        submittedBy: user.wallet,
        createdAt: new Date().toISOString(),
      },
    })

    return NextResponse.json({
      ok: true,
      workflowId,
      agentSlug,
      rating,
      message: 'Review recorded successfully',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
