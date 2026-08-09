/**
 * GET /api/me/ledger — real USD money movement for the current user.
 *
 * Unified feed of the two tables that record actual funds:
 *   - topup_deposits      → USDC deposited into the user's own vault
 *                           (verified against an on-chain Transfer receipt)
 *   - nanopayment_events  → per-skill x402 payments settled on-chain out
 *                           of that vault while workflows run
 *
 * This used to read `credit_ledger` — the synthetic "credits" currency
 * that the live system stopped writing to. That table is now frozen
 * historical data, so serving it here showed users a feed that never
 * moved while their real balance did. Amounts are USD, signed:
 * positive = money in, negative = money out.
 */
import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { nanopaymentEvents, topupDeposits, workflows } from '@/lib/db/schema'

export interface LedgerEntry {
  id: string
  /** Signed USD amount — positive = deposit, negative = spend. */
  amountUsdc: number
  kind: 'topup' | 'spend'
  label: string
  workflowId: string | null
  txHash: string | null
  status: string | null
  createdAt: string
}

export async function GET() {
  try {
    const u = await getCurrentUser()

    const [deposits, spends] = await Promise.all([
      withDbRetry(
        () => db
          .select()
          .from(topupDeposits)
          .where(eq(topupDeposits.userId, u.id))
          .orderBy(desc(topupDeposits.createdAt))
          .limit(50),
        { label: 'ledger:deposits' },
      ),
      withDbRetry(
        () => db
          .select({
            id: nanopaymentEvents.id,
            workflowId: nanopaymentEvents.workflowId,
            skillName: nanopaymentEvents.skillName,
            amountUsdc: nanopaymentEvents.amountUsdc,
            status: nanopaymentEvents.status,
            txHash: nanopaymentEvents.txHash,
            createdAt: nanopaymentEvents.createdAt,
          })
          .from(nanopaymentEvents)
          .innerJoin(workflows, eq(nanopaymentEvents.workflowId, workflows.id))
          .where(eq(workflows.userId, u.id))
          .orderBy(desc(nanopaymentEvents.createdAt))
          .limit(100),
        { label: 'ledger:spends' },
      ),
    ])

    const entries: LedgerEntry[] = [
      ...deposits.map((d) => ({
        id: d.id,
        amountUsdc: parseFloat(d.amountUsdc),
        kind: 'topup' as const,
        label: d.reason === 'vault_prefund' ? 'Starter vault funding' : 'Vault top-up',
        workflowId: null,
        txHash: d.txHash,
        status: 'settled',
        createdAt: d.createdAt.toISOString(),
      })),
      ...spends.map((s) => ({
        id: s.id,
        amountUsdc: -parseFloat(s.amountUsdc),
        kind: 'spend' as const,
        label: `Agent · ${s.skillName}`,
        workflowId: s.workflowId,
        txHash: s.txHash,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    return NextResponse.json({ ledger: entries })
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ ledger: [], error: 'unauthenticated' }, { status: 401 })
    }
    console.error('[/api/me/ledger] failed after retries', e)
    return NextResponse.json({ ledger: [], error: 'db_unavailable' }, { status: 503 })
  }
}
