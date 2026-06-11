import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { users, workflows, skills, deployments, raffles, creditLedger, nanopaymentEvents } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { OrbitportSDK } from '@spacecomputer-io/orbitport-sdk-ts'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // 1. User Statistics
    const usersCountRes = await db.select({ count: sql<number>`count(*)::int` }).from(users)
    const totalUsers = usersCountRes[0]?.count ?? 0

    const totalCreditsRes = await db.select({ sum: sql<number>`sum(${users.credits})::int` }).from(users)
    const totalCredits = totalCreditsRes[0]?.sum ?? 0

    // 2. Workflows & Commerce Volume
    const workflowsCountRes = await db.select({ count: sql<number>`count(*)::int` }).from(workflows)
    const totalWorkflows = workflowsCountRes[0]?.count ?? 0

    const completedWorkflowsRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflows)
      .where(eq(workflows.status, 'completed'))
    const completedWorkflows = completedWorkflowsRes[0]?.count ?? 0

    const commerceVolumeRes = await db
      .select({
        volumes: sql<string[]>`array_remove(array_agg(${workflows.erc8183BudgetUsdc}), null)`
      })
      .from(workflows)
    
    const volumes = commerceVolumeRes[0]?.volumes ?? []
    const totalUSDCVolume = volumes.reduce((sum, v) => sum + parseFloat(v || '0'), 0)

    // 3. Automated Agents (Skills & Deployments)
    const skillsCountRes = await db.select({ count: sql<number>`count(*)::int` }).from(skills)
    const totalSkills = skillsCountRes[0]?.count ?? 0

    const deploymentsCountRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(deployments)
      .where(eq(deployments.status, 'active'))
    const activeDeployments = deploymentsCountRes[0]?.count ?? 0

    // 4. Cosmic Raffle Stats
    const rafflesCountRes = await db.select({ count: sql<number>`count(*)::int` }).from(raffles)
    const totalRaffles = rafflesCountRes[0]?.count ?? 0

    const completedRafflesRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(raffles)
      .where(eq(raffles.drawn, true))
    const completedRaffles = completedRafflesRes[0]?.count ?? 0

    // 4.5. x402 Nanopayment Stats
    const totalNanopaymentsRes = await db
      .select({
        count: sql<number>`count(*)::int`,
        sum: sql<string>`coalesce(sum(${nanopaymentEvents.amountUsdc}::numeric), 0)`
      })
      .from(nanopaymentEvents)
    const totalNanopaymentCalls = totalNanopaymentsRes[0]?.count ?? 0
    const totalNanopaymentRevenue = parseFloat(totalNanopaymentsRes[0]?.sum ?? '0')

    const recentNanopayments = await db
      .select({
        id: nanopaymentEvents.id,
        skillName: nanopaymentEvents.skillName,
        amountUsdc: nanopaymentEvents.amountUsdc,
        buyerAddress: nanopaymentEvents.buyerAddress,
        status: nanopaymentEvents.status,
        createdAt: nanopaymentEvents.createdAt,
      })
      .from(nanopaymentEvents)
      .orderBy(sql`${nanopaymentEvents.createdAt} desc`)
      .limit(20)

    // 5. Recent System Activity Ledger
    const recentActivity = await db
      .select({
        id: creditLedger.id,
        reason: creditLedger.reason,
        delta: creditLedger.delta,
        createdAt: creditLedger.createdAt,
        userWallet: users.wallet,
      })
      .from(creditLedger)
      .leftJoin(users, eq(creditLedger.userId, users.id))
      .orderBy(sql`${creditLedger.createdAt} desc`)
      .limit(10)

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

    return NextResponse.json({
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
    })
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
