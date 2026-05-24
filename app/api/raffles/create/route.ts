import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { raffles } from '@/lib/db/schema'
import { getCurrentUser } from '@/lib/auth/session'
import { withDbRetry } from '@/lib/db/retry'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/create
 * Caches the deployed raffle metadata and entries in PostgreSQL.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    const body = await request.json()

    const {
      title,
      description,
      prizeDescription,
      winnerCount,
      totalEntries,
      merkleRoot,
      commitBlock,
      onChainRaffleId,
      txHash,
      contractAddress,
      rawEntries
    } = body

    if (!title || !merkleRoot || !rawEntries) {
      return NextResponse.json({ error: 'Missing required parameters.' }, { status: 400 })
    }

    const [inserted] = await withDbRetry(() => db
      .insert(raffles)
      .values({
        userId: user.id,
        title,
        description: description ?? '',
        prizeDescription: prizeDescription ?? '',
        winnerCount: Number(winnerCount),
        totalEntries: Number(totalEntries),
        merkleRoot,
        commitBlock: Number(commitBlock),
        drawn: false,
        onChainRaffleId: onChainRaffleId !== undefined ? Number(onChainRaffleId) : null,
        txHash: txHash ?? null,
        contractAddress: contractAddress ?? null,
        rawEntries,
      })
      .returning()
    )

    return NextResponse.json({ success: true, raffle: inserted })
  } catch (error) {
    console.error('❌ [/api/raffles/create] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to save raffle.'
    }, { status: 500 })
  }
}
