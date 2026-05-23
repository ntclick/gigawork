import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { raffles, raffleWinners } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getWinningIndicesFromContract } from '@/lib/cosmic-raffle/contract'
import { parseEntries } from '@/lib/cosmic-raffle/parseEntries'
import { MerkleTree } from '@/lib/cosmic-raffle/merkle'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { txHash, seed } = await request.json()

    if (!txHash || !seed) {
      return NextResponse.json({ error: 'Missing required parameters: txHash and seed.' }, { status: 400 })
    }

    // 1. Fetch raffle details
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

    if (raffle.onChainRaffleId === null) {
      return NextResponse.json({ error: 'Raffle is not registered on-chain.' }, { status: 400 })
    }

    // 2. Retrieve winning indices from the smart contract (populated on-chain by drawWinners transaction)
    console.log(`📥 Querying smart contract for winning indices for raffleId: ${raffle.onChainRaffleId}...`)
    const winningIndices = await getWinningIndicesFromContract(raffle.onChainRaffleId)

    // 3. Parse and rebuild Merkle tree of entries
    const entries = parseEntries(raffle.rawEntries)
    const tree = new MerkleTree(entries)

    // 4. Store winners and proofs in DB
    const winnersToInsert = winningIndices.map((index) => {
      const username = entries[index]
      const merkleProof = tree.getProof(index)
      return {
        raffleId: raffle.id,
        index,
        username,
        merkleProof,
      }
    })

    console.log(`💾 Caching ${winnersToInsert.length} winners in database...`)
    await db.insert(raffleWinners).values(winnersToInsert)

    // 5. Update raffle state in DB
    const [updatedRaffle] = await db
      .update(raffles)
      .set({
        drawn: true,
        seed: seed,
        txHash: txHash,
      })
      .where(eq(raffles.id, raffle.id))
      .returning()

    return NextResponse.json({
      success: true,
      raffle: updatedRaffle,
      winners: winnersToInsert,
      txHash,
    })
  } catch (error) {
    console.error('❌ [/api/raffles/[id]/complete-draw] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to finalize draw state.'
    }, { status: 500 })
  }
}
