import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { users, workflows, skills, deployments, raffles, creditLedger, nanopaymentEvents } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { OrbitportSDK } from '@spacecomputer-io/orbitport-sdk-ts'

export const dynamic = 'force-dynamic'

interface SystemStatsResponse {
  success: boolean
  stats: {
    totalUsers: number
    totalCredits: number
    totalWorkflows: number
    completedWorkflows: number
    totalUSDCVolume: string
    totalSkills: number
    activeDeployments: number
    totalRaffles: number
    completedRaffles: number
    spaceComputerStatus: string
    spaceComputerDetail: string
    totalNanopaymentCalls: number
    totalNanopaymentRevenue: string
  }
  recentActivity: unknown[]
  recentNanopayments: unknown[]
}

interface CacheEntry {
  data: SystemStatsResponse
  expiresAt: number
}

let cache: CacheEntry | null = null
const CACHE_TTL_MS = 25000 // 25 seconds (TTL ~20-30s)

export async function GET() {
  const now = Date.now()
  if (cache && now < cache.expiresAt) {
    return NextResponse.json(cache.data)
  }

  try {
    const [
      usersCountRes,
      totalCreditsRes,
      workflowsCountRes,
      completedWorkflowsRes,
      commerceVolumeRes,
      skillsCountRes,
      deploymentsCountRes,
      rafflesCountRes,
      completedRafflesRes,
      totalNanopaymentsRes,
      recentNanopayments,
      recentActivity,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db.select({ sum: sql<number>`sum(${users.credits})::int` }).from(users),
      db.select({ count: sql<number>`count(*)::int` }).from(workflows),
      db.select({ count: sql<number>`count(*)::int` }).from(workflows).where(eq(workflows.status, 'completed')),
      db.select({ sum: sql<string>`coalesce(sum(${workflows.erc8183BudgetUsdc}::numeric), 0)` }).from(workflows),
      db.select({ count: sql<number>`count(*)::int` }).from(skills),
      db.select({ count: sql<number>`count(*)::int` }).from(deployments).where(eq(deployments.status, 'active')),
      db.select({ count: sql<number>`count(*)::int` }).from(raffles),
      db.select({ count: sql<number>`count(*)::int` }).from(raffles).where(eq(raffles.drawn, true)),
      db.select({
        count: sql<number>`count(*)::int`,
        sum: sql<string>`coalesce(sum(${nanopaymentEvents.amountUsdc}::numeric), 0)`
      }).from(nanopaymentEvents),
      db.select({
        id: nanopaymentEvents.id,
        skillName: nanopaymentEvents.skillName,
        amountUsdc: nanopaymentEvents.amountUsdc,
        buyerAddress: nanopaymentEvents.buyerAddress,
        status: nanopaymentEvents.status,
        createdAt: nanopaymentEvents.createdAt,
      })
      .from(nanopaymentEvents)
      .orderBy(sql`${nanopaymentEvents.createdAt} desc`)
      .limit(20),
      db.select({
        id: creditLedger.id,
        reason: creditLedger.reason,
        delta: creditLedger.delta,
        createdAt: creditLedger.createdAt,
        userWallet: users.wallet,
      })
      .from(creditLedger)
      .leftJoin(users, eq(creditLedger.userId, users.id))
      .orderBy(sql`${creditLedger.createdAt} desc`)
      .limit(10),
    ])

    const totalUsers = usersCountRes[0]?.count ?? 0
    const totalCredits = totalCreditsRes[0]?.sum ?? 0
    const totalWorkflows = workflowsCountRes[0]?.count ?? 0
    const completedWorkflows = completedWorkflowsRes[0]?.count ?? 0
    const totalUSDCVolume = parseFloat(commerceVolumeRes[0]?.sum ?? '0')
    const totalSkills = skillsCountRes[0]?.count ?? 0
    const activeDeployments = deploymentsCountRes[0]?.count ?? 0
    const totalRaffles = rafflesCountRes[0]?.count ?? 0
    const completedRaffles = completedRafflesRes[0]?.count ?? 0

    const totalNanopaymentCalls = totalNanopaymentsRes[0]?.count ?? 0
    const totalNanopaymentRevenue = parseFloat(totalNanopaymentsRes[0]?.sum ?? '0')

    // 6. Orbitport SDK cTRNG Diagnostic Status
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
        spaceComputerDetail = 'Live JWT connectivity operational.'
      } catch (err) {
        spaceComputerStatus = 'auth_error'
        spaceComputerDetail = err instanceof Error ? err.message : 'Auth verification error'
      }
    }

    const responseData: SystemStatsResponse = {
      success: true,
      stats: {
        totalUsers,
        totalCredits,
        totalWorkflows,
        completedWorkflows,
        totalUSDCVolume: totalUSDCVolume.toFixed(2),
        totalSkills,
        activeDeployments,
        totalRaffles,
        completedRaffles,
        spaceComputerStatus,
        spaceComputerDetail,
        totalNanopaymentCalls,
        totalNanopaymentRevenue: totalNanopaymentRevenue.toFixed(3),
      },
      recentActivity,
      recentNanopayments,
    }

    cache = {
      data: responseData,
      expiresAt: Date.now() + CACHE_TTL_MS,
    }

    return NextResponse.json(responseData)
  } catch (error) {
    console.error('❌ [/api/admin/system-stats] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve global system stats.',
      },
      { status: 500 },
    )
  }
}
