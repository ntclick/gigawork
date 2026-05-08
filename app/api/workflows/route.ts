import { NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
export const dynamic = 'force-dynamic'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { workflows } from '@/lib/db/schema'

export async function GET() {
  try {
    const u = await getCurrentUser()
    const rows = await withDbRetry(
      () => db
        .select()
        .from(workflows)
        .where(and(eq(workflows.userId, u.id)))
        .orderBy(desc(workflows.createdAt))
        .limit(100),
      { label: 'list-workflows' },
    )
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
