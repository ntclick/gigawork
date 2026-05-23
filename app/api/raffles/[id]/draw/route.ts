import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { raffles, raffleWinners } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { fetchCosmicSeed } from '@/lib/cosmic-raffle/fetchCosmicSeed'
import { publicClient, drawWinnersOnChain, getWinningIndicesFromContract } from '@/lib/cosmic-raffle/contract'
import { parseEntries } from '@/lib/cosmic-raffle/parseEntries'
import { MerkleTree } from '@/lib/cosmic-raffle/merkle'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/draw
 * Triggers the on-chain drawing process once the commit block is mined.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

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

    // 2. Verify if target block has been mined
    const currentBlock = await publicClient.getBlockNumber()
    const targetBlock = BigInt(raffle.commitBlock)

    if (currentBlock < targetBlock) {
      const blocksRemaining = targetBlock - currentBlock
      return NextResponse.json({
        error: `Target block ${raffle.commitBlock} has not been reached yet. Current block: ${currentBlock}. Please wait approximately ${blocksRemaining} blocks (around ${Number(blocksRemaining) * 2} seconds).`,
        blocksRemaining: Number(blocksRemaining),
        currentBlock: Number(currentBlock),
        commitBlock: raffle.commitBlock,
      }, { status: 423 }) // 423 Locked
    }

    // 3. Fetch Cosmic Seed randomness from SpaceComputer
    console.log(`🛰️ Fetching cosmic randomness seed for block ${raffle.commitBlock}...`)
    const seed = await fetchCosmicSeed(raffle.commitBlock)

    // 4. Trigger on-chain contract draw
    console.log(`🔗 Sending contract transaction to draw winners on-chain...`)
    const txHash = await drawWinnersOnChain(raffle.onChainRaffleId, seed)

    // 5. Retrieve winning indices from the smart contract to ensure maximum credibility
    console.log(`📥 Querying smart contract for winning indices...`)
    const winningIndices = await getWinningIndicesFromContract(raffle.onChainRaffleId)

    // 6. Parse and rebuild Merkle tree of entries
    const entries = parseEntries(raffle.rawEntries)
    const tree = new MerkleTree(entries)

    // 7. Store winners and proofs in DB
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

    // 8. Update raffle state in DB
    const [updatedRaffle] = await db
      .update(raffles)
      .set({
        drawn: true,
        seed: seed,
        txHash: txHash, // update with the draw tx hash
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
    console.error('❌ [/api/raffles/[id]/draw] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Draw operation failed.'
    }, { status: 500 })
  }
}
