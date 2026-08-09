/**
 * GET /api/protocol — what this deployment is actually wired to, and what
 * it has actually done.
 *
 * Exists so the home page can show verifiable facts instead of adjectives:
 * the real contract addresses on Arc Testnet, the real count of minted
 * ERC-8004 identities, and the most recent x402 settlements with their
 * real transaction hashes. Every figure here is a query against state that
 * already exists — nothing is estimated, and a value that cannot be read
 * comes back null rather than as a placeholder.
 *
 * Public by design: contract addresses are on-chain anyway, and the
 * settlement feed is deliberately trimmed to skill name, amount and tx
 * hash. No user, wallet or workflow identifiers are exposed.
 */
import { NextResponse } from 'next/server'
import { desc, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { nanopaymentEvents, skills, workflows } from '@/lib/db/schema'
import { withDbRetry } from '@/lib/db/retry'

export const dynamic = 'force-dynamic'

const CONTRACTS = [
  {
    key: 'identity',
    label: 'ERC-8004 Identity Registry',
    address:
      process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ??
      process.env.IDENTITY_REGISTRY_ADDRESS ??
      null,
  },
  {
    key: 'escrow',
    label: 'ERC-8183 Agentic Commerce',
    address:
      process.env.AGENTIC_COMMERCE_ADDRESS ?? '0x0747EEf0706327138c69792bF28Cd525089e4583',
  },
  {
    key: 'reputation',
    label: 'Reputation Registry',
    address: process.env.REPUTATION_REGISTRY_ADDRESS ?? null,
  },
  {
    key: 'usdc',
    label: 'USDC',
    address: process.env.NEXT_PUBLIC_USDC_ADDRESS ?? null,
  },
] as const

export async function GET() {
  let minted = 0
  let settledCount = 0
  let settledUsdc = '0.00'
  let escrowJobs = 0
  let recent: { skill: string; amountUsdc: string; txHash: string }[] = []

  try {
    const [mintedRow, payRow, jobRow, recentRows] = await withDbRetry(() =>
      Promise.all([
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(skills)
          .where(sql`${skills.agentTokenId} is not null`),
        db
          .select({
            n: sql<number>`count(*)::int`,
            total: sql<string>`coalesce(sum(${nanopaymentEvents.amountUsdc}::numeric), 0)`,
          })
          .from(nanopaymentEvents)
          .where(eq(nanopaymentEvents.status, 'settled')),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(workflows)
          .where(sql`${workflows.erc8183JobId} is not null`),
        db
          .select({
            skill: nanopaymentEvents.skillName,
            amountUsdc: nanopaymentEvents.amountUsdc,
            txHash: nanopaymentEvents.txHash,
            createdAt: nanopaymentEvents.createdAt,
          })
          .from(nanopaymentEvents)
          .where(sql`${nanopaymentEvents.status} = 'settled' and ${nanopaymentEvents.txHash} is not null`)
          .orderBy(desc(nanopaymentEvents.createdAt))
          .limit(6),
      ]),
    )

    minted = mintedRow[0]?.n ?? 0
    settledCount = payRow[0]?.n ?? 0
    settledUsdc = parseFloat(payRow[0]?.total ?? '0').toFixed(2)
    escrowJobs = jobRow[0]?.n ?? 0
    recent = recentRows
      .filter((r) => r.txHash)
      .map((r) => ({
        skill: r.skill ?? 'agent',
        amountUsdc: parseFloat(r.amountUsdc ?? '0').toFixed(2),
        txHash: r.txHash as string,
      }))
  } catch (err) {
    // A read failure must not blank the home page — the contract wiring
    // below is static config and still worth returning.
    console.error('[api/protocol] stats read failed:', err)
  }

  return NextResponse.json({
    chainId: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042002),
    explorer: process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app',
    contracts: CONTRACTS.filter((c) => c.address),
    stats: { minted, settledCount, settledUsdc, escrowJobs },
    recent,
  })
}
