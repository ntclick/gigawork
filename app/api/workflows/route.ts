import { NextResponse } from 'next/server'
import { desc } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { workflows } from '@/lib/db/schema'

export async function GET() {
  try {
    const rows = await withDbRetry(
      () => db.select().from(workflows).orderBy(desc(workflows.createdAt)).limit(100),
      { label: 'list-workflows' },
    )
    return NextResponse.json({ workflows: rows })
  } catch (e) {
    console.error('[/api/workflows] failed after retries', e)
    return NextResponse.json(
      { workflows: [], error: 'db_unavailable' },
      { status: 503 },
    )
  }
}
