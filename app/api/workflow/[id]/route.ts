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
    const [row] = await withDbRetry(
      () => db
        .select()
        .from(workflows)
        .where(eq(workflows.id, id))
        .limit(1),
      { label: 'workflow:get' },
    )
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(row)
  } catch (e) {
    console.error('[/api/workflow/:id] failed', e)
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  }
}
