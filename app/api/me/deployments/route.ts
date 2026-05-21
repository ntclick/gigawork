import { NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { deployments, workflows } from '@/lib/db/schema'

export async function GET() {
  let u
  try {
    u = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  try {
    const list = await withDbRetry(
      () => db
        .select({
          id: deployments.id,
          workflowId: deployments.workflowId,
          userId: deployments.userId,
          cronExpression: deployments.cronExpression,
          status: deployments.status,
          createdAt: deployments.createdAt,
          workflowPrompt: workflows.prompt,
          workflowStatus: workflows.status,
        })
        .from(deployments)
        .innerJoin(workflows, eq(deployments.workflowId, workflows.id))
        .where(eq(deployments.userId, u.id))
        .orderBy(desc(deployments.createdAt)),
      { label: 'me-deployments:list' }
    )

    return NextResponse.json(list)
  } catch (e) {
    console.error('[/api/me/deployments] failed', e)
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  }
}
