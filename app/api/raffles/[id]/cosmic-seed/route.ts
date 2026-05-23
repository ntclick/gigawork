import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { raffles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { fetchCosmicSeed } from '@/lib/cosmic-raffle/fetchCosmicSeed'
import { publicClient } from '@/lib/cosmic-raffle/contract'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const [raffle] = await db
      .select()
      .from(raffles)
      .where(eq(raffles.id, id))
      .limit(1)

    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found.' }, { status: 404 })
    }

    if (raffle.drawn) {
      return NextResponse.json({ error: 'Raffle has already been drawn.' }, { status: 400 })
    }

    // Verify block target has been reached
    const currentBlock = await publicClient.getBlockNumber()
    const targetBlock = BigInt(raffle.commitBlock)

    if (currentBlock < targetBlock) {
      const blocksRemaining = targetBlock - currentBlock
      return NextResponse.json({
        error: `Target block ${raffle.commitBlock} has not been reached yet. Current block: ${currentBlock}`,
        blocksRemaining: Number(blocksRemaining),
        currentBlock: Number(currentBlock),
        commitBlock: raffle.commitBlock,
      }, { status: 423 })
    }

    // Fetch seed from SpaceComputer public beacon mixed with block hash
    const seed = await fetchCosmicSeed(raffle.commitBlock)

    return NextResponse.json({
      success: true,
      seed,
    })
  } catch (error) {
    console.error('❌ [/api/raffles/[id]/cosmic-seed] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fetch cosmic seed.'
    }, { status: 500 })
  }
}
