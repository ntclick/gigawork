import { NextResponse } from 'next/server'
import { parseEntries } from '@/lib/cosmic-raffle/parseEntries'
import { MerkleTree } from '@/lib/cosmic-raffle/merkle'
import { publicClient } from '@/lib/cosmic-raffle/contract'
import { getCurrentUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/prepare-list
 * Accepts raw CSV/text entries and prepares the Merkle tree, leaf details,
 * and calculates the target commit block (10-block future buffer) on Arc.
 */
export async function POST(request: Request) {
  try {
    // 1. Authenticate user
    await getCurrentUser()

    // 2. Parse payload
    const { rawInput, winnerCount } = await request.json()

    if (!rawInput || typeof rawInput !== 'string') {
      return NextResponse.json({ error: 'Contestant entries are required.' }, { status: 400 })
    }

    const wCount = Number(winnerCount)
    if (isNaN(wCount) || wCount <= 0) {
      return NextResponse.json({ error: 'Winner count must be a positive integer.' }, { status: 400 })
    }

    // 3. Process entries
    const entries = parseEntries(rawInput)
    if (entries.length === 0) {
      return NextResponse.json({ error: 'No valid unique contestants found in the input.' }, { status: 400 })
    }

    if (wCount > entries.length) {
      return NextResponse.json({
        error: `Winner count (${wCount}) cannot exceed total unique entries (${entries.length}).`
      }, { status: 400 })
    }

    // 4. Generate Merkle Root
    const tree = new MerkleTree(entries)
    const merkleRoot = tree.getRoot()

    // 5. Query Arc blockchain for future block target (10 block security buffer)
    const currentBlock = await publicClient.getBlockNumber()
    const commitBlock = Number(currentBlock) + 10

    return NextResponse.json({
      entries,
      totalEntries: entries.length,
      merkleRoot,
      commitBlock,
      winnerCount: wCount,
    })
  } catch (error) {
    console.error('❌ [/api/raffles/prepare-list] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to prepare contestant list.'
    }, { status: 500 })
  }
}
