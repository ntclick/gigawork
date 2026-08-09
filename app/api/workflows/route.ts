import { NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
export const dynamic = 'force-dynamic'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { workflows } from '@/lib/db/schema'

const userWorkflowsCache = new Map<string, { ts: number; workflows: any[] }>()
const WORKFLOWS_CACHE_TTL = 5_000

export async function GET() {
  try {
    const u = await getCurrentUser()
    const now = Date.now()
    const cached = userWorkflowsCache.get(u.id)

    if (cached && now - cached.ts < WORKFLOWS_CACHE_TTL) {
      return NextResponse.json({ workflows: cached.workflows })
    }

    const rows = await withDbRetry(
      () => db
        .select()
        .from(workflows)
        .where(and(eq(workflows.userId, u.id)))
        .orderBy(desc(workflows.createdAt))
        .limit(50),
      { label: 'list-workflows' },
    )

    userWorkflowsCache.set(u.id, { ts: now, workflows: rows })
    return NextResponse.json({ workflows: rows })
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json(
        { workflows: [], error: 'unauthenticated' },
        { status: 401 },
      )
    }
    console.error('[/api/workflows] failed after retries', e)
    return NextResponse.json(
      {
        workflows: [],
        error: 'db_unavailable',
        message: (e instanceof Error ? e.message : String(e)).slice(0, 800),
      },
      { status: 503 },
    )
  }
}

export async function DELETE() {
  try {
    const u = await getCurrentUser()
    await withDbRetry(
      () => db.delete(workflows).where(eq(workflows.userId, u.id)),
      { label: 'clear-all-workflows' },
    )
    return NextResponse.json({ ok: true, message: 'All history cleared' })
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    return NextResponse.json({ error: 'clear_failed' }, { status: 500 })
  }
}
