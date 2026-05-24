import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { raffles } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import { withDbRetry } from '@/lib/db/retry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/raffles/list
 * Returns a list of all raffles, ordered by creation date descending.
 */
export async function GET() {
  try {
    const list = await withDbRetry(() => db
      .select()
      .from(raffles)
      .orderBy(desc(raffles.createdAt))
    )

    return NextResponse.json({ raffles: list })
  } catch (error) {
    console.error('❌ [/api/raffles/list] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to list raffles.'
    }, { status: 500 })
  }
}
