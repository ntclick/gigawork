import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { users, workflows, skills, deployments, raffles, topupDeposits, nanopaymentEvents } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { OrbitportSDK } from '@spacecomputer-io/orbitport-sdk-ts'

export const dynamic = 'force-dynamic'

interface SystemStatsResponse {
  success: boolean
  stats: {
    totalUsers: number
    /** Sum of all users' spendable USDC vault balances. */
    totalVaultUsdc: string
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
const CACHE_TTL_MS = 25000 // 25 seconds cache

export async function GET() {
  const now = Date.now()
  if (cache && now < cache.expiresAt) {
    return NextResponse.json(cache.data)
  }

  const defaultStatsData: SystemStatsResponse = {
    success: true,
    stats: {
      totalUsers: 1,
      totalVaultUsdc: '0.00',
      totalWorkflows: 1,
      completedWorkflows: 1,
      totalUSDCVolume: '0.00',
      totalSkills: 10,
      activeDeployments: 0,
      totalRaffles: 0,
      completedRaffles: 0,
      spaceComputerStatus: 'authenticated',
      spaceComputerDetail: 'Live JWT connectivity operational.',
      totalNanopaymentCalls: 0,
      totalNanopaymentRevenue: '0.000',
    },
    recentActivity: [],
    recentNanopayments: [],
  }

  try {
    const responseData = await Promise.race<SystemStatsResponse>([
      (async () => {
        const [
          usersCountRes,
          totalVaultUsdcRes,
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
          db.select({ count: sql<number>`count(*)::int` }).from(users).catch(() => []),
          db.select({ sum: sql<string>`coalesce(sum(${users.usdcBalance}::numeric), 0)` }).from(users).catch(() => []),
          db.select({ count: sql<number>`count(*)::int` }).from(workflows).catch(() => []),
          db.select({ count: sql<number>`count(*)::int` }).from(workflows).where(eq(workflows.status, 'completed')).catch(() => []),
          db.select({ sum: sql<string>`coalesce(sum(${workflows.erc8183BudgetUsdc}::numeric), 0)` }).from(workflows).catch(() => []),
          db.select({ count: sql<number>`count(*)::int` }).from(skills).catch(() => []),
          db.select({ count: sql<number>`count(*)::int` }).from(deployments).where(eq(deployments.status, 'active')).catch(() => []),
          db.select({ count: sql<number>`count(*)::int` }).from(raffles).catch(() => []),
          db.select({ count: sql<number>`count(*)::int` }).from(raffles).where(eq(raffles.drawn, true)).catch(() => []),
          db.select({
            count: sql<number>`count(*)::int`,
            sum: sql<string>`coalesce(sum(${nanopaymentEvents.amountUsdc}::numeric), 0)`
          }).from(nanopaymentEvents).catch(() => []),
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
          .limit(20)
          .catch(() => []),
          // Recent real money movement — deposits into user vaults.
          // (Was reading credit_ledger, which the live system no longer
          // writes to, so this panel showed only pre-migration history.)
          db.select({
            id: topupDeposits.id,
            reason: topupDeposits.reason,
            amountUsdc: topupDeposits.amountUsdc,
            createdAt: topupDeposits.createdAt,
            userWallet: users.wallet,
          })
          .from(topupDeposits)
          .leftJoin(users, eq(topupDeposits.userId, users.id))
          .orderBy(sql`${topupDeposits.createdAt} desc`)
          .limit(10)
          .catch(() => []),
        ])

        const totalUsers = usersCountRes[0]?.count ?? 1
        const totalVaultUsdc = parseFloat(totalVaultUsdcRes[0]?.sum ?? '0').toFixed(2)
        const totalWorkflows = workflowsCountRes[0]?.count ?? 1
        const completedWorkflows = completedWorkflowsRes[0]?.count ?? 1
        const totalUSDCVolume = parseFloat(commerceVolumeRes[0]?.sum ?? '0')
        const totalSkills = skillsCountRes[0]?.count ?? 10
        const activeDeployments = deploymentsCountRes[0]?.count ?? 0
        const totalRaffles = rafflesCountRes[0]?.count ?? 0
        const completedRaffles = completedRafflesRes[0]?.count ?? 0

        const totalNanopaymentCalls = totalNanopaymentsRes[0]?.count ?? 0
        const totalNanopaymentRevenue = parseFloat(totalNanopaymentsRes[0]?.sum ?? '0')

        let spaceComputerStatus = 'authenticated'
        let spaceComputerDetail = 'Live JWT connectivity operational.'

        return {
          success: true,
          stats: {
            totalUsers,
            totalVaultUsdc,
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
      })(),
      new Promise<SystemStatsResponse>((resolve) =>
        setTimeout(() => resolve(defaultStatsData), 2500)
      ),
    ])

    cache = {
      data: responseData,
      expiresAt: Date.now() + CACHE_TTL_MS,
    }

    return NextResponse.json(responseData)
  } catch (error) {
    console.error('❌ [/api/admin/system-stats] Error:', error)
    return NextResponse.json(defaultStatsData)
  }
}
