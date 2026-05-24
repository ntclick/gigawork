import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { raffles, raffleWinners } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { withDbRetry } from '@/lib/db/retry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/raffles/[id]
 * Fetches the metadata of a specific raffle and its cached winners.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 1. Fetch raffle
    const [raffle] = await withDbRetry(() => db
      .select()
      .from(raffles)
      .where(eq(raffles.id, id))
      .limit(1)
    )

    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found.' }, { status: 404 })
    }

    // 2. Fetch winners if drawn
    let winners: typeof raffleWinners.$inferSelect[] = []
    if (raffle.drawn) {
      winners = await withDbRetry(() => db
        .select()
        .from(raffleWinners)
        .where(eq(raffleWinners.raffleId, raffle.id))
      )
    }

    return NextResponse.json({
      raffle,
      winners,
    })
  } catch (error) {
    console.error('❌ [/api/raffles/[id]] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fetch raffle details.'
    }, { status: 500 })
  }
}
