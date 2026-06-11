import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { nanopaymentEvents } from '@/lib/db/schema'

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params

  try {
    await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  // Fetch nanopayment events for this workflow
  const events = await withDbRetry(
    () => db
      .select()
      .from(nanopaymentEvents)
      .where(eq(nanopaymentEvents.workflowId, id))
      .orderBy(desc(nanopaymentEvents.createdAt))
      .limit(50),
    { label: 'workflow-nanopayments:events' }
  )

  return NextResponse.json({ events })
}
