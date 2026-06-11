import { NextResponse } from 'next/server'
import { lt, or, gte, and, eq, not } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { agentLiveness } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const guard =
    req.headers.get('x-cron-token') ??
    req.headers.get('x-migrate-token') ??
    ''
  if (guard !== (process.env.MIGRATE_TOKEN ?? 'dev-migrate')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const now = new Date()
  const cutoffInactive = new Date(now.getTime() - 25 * 60 * 1000) // 25 mins
  const cutoffDegraded = new Date(now.getTime() - 10 * 60 * 1000) // 10 mins

  // 1. Transition to INACTIVE if heartbeat is older than 25 mins OR consecutive failures >= 3
  await db
    .update(agentLiveness)
    .set({ status: 'INACTIVE' })
    .where(
      and(
        not(eq(agentLiveness.status, 'INACTIVE')),
        or(
          lt(agentLiveness.lastHeartbeatAt, cutoffInactive),
          gte(agentLiveness.consecutiveJobFailures, 3)
        )
      )
    )

  // 2. Transition to DEGRADED if heartbeat is older than 10 mins (and status is ACTIVE)
  await db
    .update(agentLiveness)
    .set({ status: 'DEGRADED' })
    .where(
      and(
        eq(agentLiveness.status, 'ACTIVE'),
        lt(agentLiveness.lastHeartbeatAt, cutoffDegraded),
        lt(agentLiveness.consecutiveJobFailures, 3)
      )
    )

  return NextResponse.json({
    ok: true,
    message: 'Liveness sweep completed successfully.',
    sweptAt: now.toISOString(),
  })
}
