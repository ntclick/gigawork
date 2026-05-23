import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { raffles, raffleWinners } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { parseEntries } from '@/lib/cosmic-raffle/parseEntries'
import { MerkleTree } from '@/lib/cosmic-raffle/merkle'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/verify-entry
 * Verifies if a user is part of the raffle and checks if they won.
 * Generates their Merkle proof on the fly.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { username } = await request.json()

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'Username or address is required.' }, { status: 400 })
    }

    const trimmedUsername = username.trim()

    // 1. Fetch raffle details
    const [raffle] = await db
      .select()
      .from(raffles)
      .where(eq(raffles.id, id))
      .limit(1)

    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found.' }, { status: 404 })
    }

    // 2. Parse entries and build Merkle Tree
    const entries = parseEntries(raffle.rawEntries)
    const entryIndex = entries.findIndex(
      (entry) => entry.toLowerCase() === trimmedUsername.toLowerCase()
    )

    if (entryIndex === -1) {
      return NextResponse.json({
        exists: false,
        isWinner: false,
        message: `"${trimmedUsername}" was not found in the contestant list for this raffle.`,
      })
    }

    const tree = new MerkleTree(entries)
    const proof = tree.getProof(entryIndex)
    const isValid = MerkleTree.verify(entries[entryIndex], proof, raffle.merkleRoot as `0x${string}`)

    // 3. Check if they are a winner
    let isWinner = false
    let winningIndex = -1

    if (raffle.drawn) {
      // Find winner row in db
      const [winnerRecord] = await db
        .select()
        .from(raffleWinners)
        .where(
          and(
            eq(raffleWinners.raffleId, raffle.id),
            eq(raffleWinners.index, entryIndex)
          )
        )
        .limit(1)

      if (winnerRecord) {
        isWinner = true
        winningIndex = entryIndex
      }
    }

    return NextResponse.json({
      exists: true,
      username: entries[entryIndex],
      index: entryIndex,
      proof,
      isValid,
      isWinner,
      winningIndex,
      merkleRoot: raffle.merkleRoot,
    })
  } catch (error) {
    console.error('❌ [/api/raffles/[id]/verify-entry] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to verify entry.'
    }, { status: 500 })
  }
}
