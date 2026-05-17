import { NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { incrementReputationBatch } from '@/lib/chain/reputation'
import { db } from '@/lib/db/client'
import { messages, nodes, skills, users, workflows } from '@/lib/db/schema'

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params

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
    .where(and(eq(workflows.id, id), eq(workflows.userId, user.id)))
    .limit(1)

  if (!wf) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (wf.status !== 'completed' && wf.status !== 'failed') {
    return NextResponse.json({ error: 'not_terminal', status: wf.status }, { status: 409 })
  }

  const existing = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.workflowId, id),
        eq(messages.toolName, 'reputationUpdate'),
      ),
    )
    .limit(1)

  if (existing.length > 0) {
    return NextResponse.json({ ok: true, already: true })
  }

  const outcome = wf.status === 'failed' ? 'failed' : 'completed'

  try {
    const completedRows = await db
      .select({ skillId: skills.id, agentTokenId: skills.agentTokenId })
      .from(nodes)
      .innerJoin(skills, eq(nodes.skillId, skills.id))
      .where(eq(nodes.workflowId, id))

    const [u] = user.id
      ? await db
          .select({ identityTokenId: users.identityTokenId })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1)
      : []

    const tokenIds = [
      ...new Set(
        [
          ...completedRows.map((r) => r.agentTokenId),
          u?.identityTokenId,
        ].filter(Boolean),
      ),
    ] as string[]

    const uniqueSkillIds = [...new Set(completedRows.map((r) => r.skillId))]
    for (const skillId of uniqueSkillIds) {
      await db
        .update(skills)
        .set({ reputationScore: sql`reputation_score + 1` })
        .where(eq(skills.id, skillId))
    }

    if (user.id) {
      await db
        .update(users)
        .set({ reputationScore: sql`reputation_score + 1` })
        .where(eq(users.id, user.id))
    }

    if (tokenIds.length === 0) {
      await db.insert(messages).values({
        workflowId: id,
        role: 'system',
        toolName: 'reputationUpdate',
        toolPayload: {
          tx: null,
          tokenIds: [],
          status: 'skipped',
          outcome,
          reason: 'No on-chain identity tokens found.',
        },
        content: null,
      })
      return NextResponse.json({ ok: true, skipped: true })
    }

    const repTx = await incrementReputationBatch(tokenIds, outcome)

    await db.insert(messages).values({
      workflowId: id,
      role: 'system',
      toolName: 'reputationUpdate',
      toolPayload: {
        tx: repTx,
        tokenIds,
        outcome,
        status: repTx ? 'recorded' : 'skipped',
        reason: repTx ? undefined : 'incrementReputationBatch returned null (registry or admin not configured)',
      },
      content: null,
    })

    return NextResponse.json({ ok: true, tx: repTx })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[reputation/reconcile] failed', msg)

    try {
      await db.insert(messages).values({
        workflowId: id,
        role: 'system',
        toolName: 'reputationUpdate',
        toolPayload: { tx: null, status: 'error', reason: msg },
        content: null,
      })
    } catch { /* double-fault */ }

    return NextResponse.json({ error: 'reputation_failed', detail: msg }, { status: 500 })
  }
}
