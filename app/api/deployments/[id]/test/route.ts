import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { deployments } from '@/lib/db/schema'
import { runCheck } from '@/lib/deployments/runCheck'

type RouteCtx = { params: Promise<{ id: string }> }

/**
 * POST /api/deployments/[id]/test
 *
 * Runs a deployment check on-demand via shared runCheck function.
 */
export async function POST(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params

  let u
  try {
    u = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  // Find deployment & verify ownership
  const [dep] = await withDbRetry(
    () => db
      .select()
      .from(deployments)
      .where(and(eq(deployments.id, id), eq(deployments.userId, u.id)))
      .limit(1),
    { label: 'test-deploy:get' }
  )
  if (!dep) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  try {
    const result = await runCheck(dep.id)
    return NextResponse.json(result)
  } catch (err) {
    console.error(`[test-deploy] runCheck failed for deployment ${dep.id}:`, err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
