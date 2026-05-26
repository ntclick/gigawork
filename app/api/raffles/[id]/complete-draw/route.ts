import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { raffles, raffleWinners } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getWinningIndicesFromContract, getWinningIndicesFromStandaloneContract, publicClient, CONTRACT_ADDRESS } from '@/lib/cosmic-raffle/contract'
import { parseEntries } from '@/lib/cosmic-raffle/parseEntries'
import { MerkleTree } from '@/lib/cosmic-raffle/merkle'
import { decodeEventLog } from 'viem'
import CosmicRaffleArtifact from '@/contracts/CosmicRaffle.json'
import { withDbRetry } from '@/lib/db/retry'
import { getCosmicProof } from '@/lib/cosmic-raffle/fetchCosmicSeed'

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

    // 1. Fetch raffle details (with retry protection)
    const [raffle] = await withDbRetry(() => db
      .select()
      .from(raffles)
      .where(eq(raffles.id, id))
      .limit(1)
    )

    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found.' }, { status: 404 })
    }

    if (raffle.drawn) {
      return NextResponse.json({ error: 'Raffle has already been drawn.' }, { status: 400 })
    }

    // 2. Retrieve winning indices from the smart contract
    let winningIndices: number[]
    let finalOnChainRaffleId: number | null = raffle.onChainRaffleId

    // Compare with the active CONTRACT_ADDRESS dynamically
    const isNewShared = raffle.contractAddress && 
      raffle.contractAddress.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()

    if (isNewShared) {
      console.log(`📡 Decoding transaction receipt logs to find raffleId for tx: ${txHash}...`)
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
      
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: CosmicRaffleArtifact.abi,
            data: log.data,
            topics: log.topics,
          })
          if (decoded.eventName === 'RaffleDrawn' && decoded.args) {
            const args = decoded.args as any
            finalOnChainRaffleId = Number(args.raffleId)
            break
          }
        } catch (e) {
          // skip log
        }
      }

      if (finalOnChainRaffleId === null) {
        return NextResponse.json({ error: 'Could not find RaffleDrawn event in transaction logs.' }, { status: 400 })
      }

      console.log(`📥 Querying single shared contract for winning indices for raffleId: ${finalOnChainRaffleId}...`)
      winningIndices = await getWinningIndicesFromContract(finalOnChainRaffleId)
    } else {
      // Legacy or Standalone flow
      const isStandalone = raffle.contractAddress && 
        raffle.contractAddress.toLowerCase() !== '0x3ea7ed77795acad23e414daea25af690810d6dbb'

      if (isStandalone) {
        console.log(`📥 Querying standalone contract for winning indices at address: ${raffle.contractAddress}...`)
        winningIndices = await getWinningIndicesFromStandaloneContract(raffle.contractAddress as `0x${string}`)
      } else {
        if (raffle.onChainRaffleId === null) {
          return NextResponse.json({ error: 'Raffle is not registered on-chain.' }, { status: 400 })
        }
        console.log(`📥 Querying shared smart contract for winning indices for raffleId: ${raffle.onChainRaffleId}...`)
        winningIndices = await getWinningIndicesFromContract(raffle.onChainRaffleId)
      }
    }

    // 3. Parse and rebuild Merkle tree of entries
    const entries = parseEntries(raffle.rawEntries)
    const tree = new MerkleTree(entries)

    // 4. Store winners and proofs in DB (with retry protection)
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
    await withDbRetry(() => db.insert(raffleWinners).values(winnersToInsert))

    // 5. Update raffle state in DB (with retry protection)
    const cosmicProof = getCosmicProof(raffle.commitBlock) ?? null
    const [updatedRaffle] = await withDbRetry(() => db
      .update(raffles)
      .set({
        drawn: true,
        seed: seed,
        txHash: txHash,
        onChainRaffleId: finalOnChainRaffleId,
        cosmicProof: cosmicProof,
      })
      .where(eq(raffles.id, raffle.id))
      .returning()
    )

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
