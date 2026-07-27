import { NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { deployments, deploymentChecks } from '@/lib/db/schema'
import { runCheck } from '@/lib/deployments/runCheck'
import { isCronDue } from '@/lib/deployments/cronParser'

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

  // 1. Fetch all active deployments
  const activeDeployments = await db
    .select()
    .from(deployments)
    .where(eq(deployments.status, 'active'))

  const results = []

  // 2. Iterate sequentially over active deployments and run due ones
  for (const dep of activeDeployments) {
    const [latestCheck] = await db
      .select({ checkedAt: deploymentChecks.checkedAt })
      .from(deploymentChecks)
      .where(eq(deploymentChecks.deploymentId, dep.id))
      .orderBy(desc(deploymentChecks.checkedAt))
      .limit(1)

    const lastCheckedAt = latestCheck?.checkedAt ?? null
    const due = isCronDue(dep.cronExpression, lastCheckedAt, now)

    if (due) {
      try {
        console.log(`[cron/deployment-check] Running due check for deployment ${dep.id} (${dep.cronExpression})...`)
        const result = await runCheck(dep.id)
        results.push({ deploymentId: dep.id, status: 'success', checkId: result.check.id })
      } catch (err) {
        console.error(`[cron/deployment-check] Failed to run check for deployment ${dep.id}:`, err)
        results.push({
          deploymentId: dep.id,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return NextResponse.json({
    ok: true,
    message: `Deployment check sweep completed. Evaluated ${activeDeployments.length} deployments, ran ${results.length} due checks.`,
    sweptAt: now.toISOString(),
    results,
  })
}
