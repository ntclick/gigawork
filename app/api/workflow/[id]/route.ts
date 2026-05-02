import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { workflows } from '@/lib/db/schema'

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
  try {
    const u = await getCurrentUser()
    const [row] = await withDbRetry(
      () => db
        .select()
        .from(workflows)
        .where(and(eq(workflows.id, id), eq(workflows.userId, u.id)))
        .limit(1),
      { label: 'workflow:get' },
    )
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(row)
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    console.error('[/api/workflow/:id] failed', e)
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  }
}
