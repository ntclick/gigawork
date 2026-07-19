/**
 * GET /api/agents/[name]/stats
 *
 * Aggregates real on-chain + DB stats for one skill:
 *   - total_dispatches: count of nodes with skillId = skill.id and status = 'completed'
 *   - failed_dispatches: status = 'failed'
 *   - success_rate: completed / (completed + failed)
 *   - total_credits_earned: sum of |delta| for credit_ledger rows where reason = 'dispatch:<name>'
 *   - recent_dispatches: 5 latest dispatch messages with tx + workflow_id
 */
import { NextResponse } from 'next/server'
import { and, desc, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { creditLedger, messages, nodes, skills } from '@/lib/db/schema'

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
  const name = id

  const [skill] = await withDbRetry(
    () => db.select().from(skills).where(eq(skills.name, name)).limit(1),
    { label: 'agent-stats:skill' },
  )
  if (!skill) {
    return NextResponse.json({ error: 'skill not found' }, { status: 404 })
  }

  // Counts by status
  const [counts] = await withDbRetry(
    () => db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`sum(case when ${nodes.status} = 'completed' then 1 else 0 end)::int`,
        failed: sql<number>`sum(case when ${nodes.status} = 'failed' then 1 else 0 end)::int`,
      })
      .from(nodes)
      .where(eq(nodes.skillId, skill.id)),
    { label: 'agent-stats:counts' },
  )

  const completed = counts?.completed ?? 0
  const failed = counts?.failed ?? 0
  const total = counts?.total ?? 0
  const successRate = completed + failed > 0 ? completed / (completed + failed) : null

  // Total credits earned (sum of dispatch ledger entries for this skill)
  const [credits] = await withDbRetry(
    () => db
      .select({
        earned: sql<number>`coalesce(sum(abs(${creditLedger.delta})), 0)::int`,
      })
      .from(creditLedger)
      .where(eq(creditLedger.reason, `dispatch:${name}`)),
    { label: 'agent-stats:credits' },
  )

  // Recent 5 dispatches with tx hash
  const recent = await withDbRetry(
    () => db
      .select({
        id: messages.id,
        workflowId: messages.workflowId,
        payload: messages.toolPayload,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(nodes, eq(nodes.id, messages.nodeId))
      .where(and(eq(nodes.skillId, skill.id), eq(messages.toolName, 'dispatchSkill')))
      .orderBy(desc(messages.createdAt))
      .limit(5),
    { label: 'agent-stats:recent' },
  )

  const recentDispatches = recent.map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>
    return {
      messageId: r.id,
      workflowId: r.workflowId,
      tx: (p.dispatch_tx as string | undefined) ?? null,
      input: p.input ?? null,
      createdAt: r.createdAt,
    }
  })

  return NextResponse.json({
    name: skill.name,
    manifest: skill.manifest,
    agent_token_id: skill.agentTokenId,
    agent_tx_hash: skill.agentTxHash,
    agent_minted_at: skill.agentMintedAt,
    stats: {
      total_dispatches: total,
      completed,
      failed,
      success_rate: successRate,
      total_credits_earned: credits?.earned ?? 0,
    },
    recent_dispatches: recentDispatches,
  })
}
