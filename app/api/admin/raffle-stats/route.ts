import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { raffles, raffleWinners, users } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { OrbitportSDK } from '@spacecomputer-io/orbitport-sdk-ts'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    // 1. Calculate General Aggregated Stats
    const totalRafflesRes = await db.select({ count: sql<number>`count(*)::int` }).from(raffles)
    const totalRaffles = totalRafflesRes[0]?.count ?? 0

    const activeRafflesRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(raffles)
      .where(eq(raffles.drawn, false))
    const activeRaffles = activeRafflesRes[0]?.count ?? 0

    const completedRafflesRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(raffles)
      .where(eq(raffles.drawn, true))
    const completedRaffles = completedRafflesRes[0]?.count ?? 0

    const totalEntriesRes = await db
      .select({ sum: sql<number>`sum(${raffles.totalEntries})::int` })
      .from(raffles)
    const totalEntries = totalEntriesRes[0]?.sum ?? 0

    const totalWinnersRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(raffleWinners)
    const totalWinners = totalWinnersRes[0]?.count ?? 0

    // 2. Query Detailed Raffle List joined with User Wallet
    const detailedRaffles = await db
      .select({
        id: raffles.id,
        title: raffles.title,
        winnerCount: raffles.winnerCount,
        totalEntries: raffles.totalEntries,
        drawn: raffles.drawn,
        commitBlock: raffles.commitBlock,
        txHash: raffles.txHash,
        createdAt: raffles.createdAt,
        hostWallet: users.wallet,
      })
      .from(raffles)
      .leftJoin(users, eq(raffles.userId, users.id))
      .orderBy(sql`${raffles.createdAt} desc`)

    // 3. Check SpaceComputer Orbitport SDK Status
    let spaceComputerStatus = 'unconfigured'
    let spaceComputerDetail = ''
    const clientId = process.env.ORBITPORT_CLIENT_ID?.trim()
    const clientSecret = process.env.ORBITPORT_CLIENT_SECRET?.trim()

    if (clientId && clientSecret) {
      try {
        const sdk = new OrbitportSDK({
          config: { clientId, clientSecret },
        })
        const isValid = await sdk.auth.isTokenValid()
        spaceComputerStatus = isValid ? 'authenticated' : 'credentials_active'
        spaceComputerDetail = 'Credentials present. SDK online.'
      } catch (err) {
        spaceComputerStatus = 'auth_error'
        spaceComputerDetail = err instanceof Error ? err.message : 'Unknown authentication error'
      }
    }

    return NextResponse.json({
      success: true,
      stats: {
        totalRaffles,
        activeRaffles,
        completedRaffles,
        totalEntries,
        totalWinners,
        spaceComputerStatus,
        spaceComputerDetail,
      },
      raffles: detailedRaffles,
    })
  } catch (error) {
    console.error('❌ [/api/admin/raffle-stats] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch admin stats.',
      },
      { status: 500 },
    )
  }
}
