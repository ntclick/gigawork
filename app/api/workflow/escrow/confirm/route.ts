import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { ERC8183_USER_CLIENT, verifyApproveAndFund } from '@/lib/chain/agenticCommerce'
import { db } from '@/lib/db/client'
import { workflows } from '@/lib/db/schema'

const Body = z.object({
  workflowId: z.string().uuid(),
  approveTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  fundTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
})

/**
 * POST /api/workflow/escrow/confirm
 *
 * Final step of user-as-client ERC-8183 flow. Verifies both user-signed tx
 * hashes (approve + fund) succeeded and were signed by the workflow owner.
 * Persists the fund tx hash + budget — this is the moment the workflow row
 * is considered "funded" by the rest of the platform. Settlement (submit +
 * complete) happens later from finalizeReport via the existing settleJob().
 */
export async function POST(req: Request) {
  if (!ERC8183_USER_CLIENT) {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 503 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, parsed.data.workflowId))
    .limit(1)
  if (!wf) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (wf.userId !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!wf.erc8183JobId) {
    return NextResponse.json(
      { error: 'job_not_created', detail: 'call /post-create first' },
      { status: 400 },
    )
  }
  if (wf.erc8183FundTx) {
    return NextResponse.json({
      ok: true,
      already: true,
      fundTx: wf.erc8183FundTx,
    })
  }

  try {
    await verifyApproveAndFund({
      approveTxHash: parsed.data.approveTxHash as `0x${string}`,
      fundTxHash: parsed.data.fundTxHash as `0x${string}`,
      expectedClient: user.wallet as `0x${string}`,
      expectedJobId: BigInt(wf.erc8183JobId),
    })

    await db
      .update(workflows)
      .set({
        status: 'planning',
        erc8183ApproveTx: parsed.data.approveTxHash,
        erc8183FundTx: parsed.data.fundTxHash,
        erc8183BudgetUsdc: process.env.ERC8183_BUDGET_USDC ?? '0.05',
      })
      .where(eq(workflows.id, wf.id))

    return NextResponse.json({
      ok: true,
      jobId: wf.erc8183JobId,
      fundTx: parsed.data.fundTxHash,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[escrow/confirm] failed', msg)
    const timedOut = /timed out while waiting for transaction/i.test(msg)
    return NextResponse.json(
      {
        error: timedOut ? 'fund_tx_pending' : 'confirm_failed',
        detail: msg,
        txHash: parsed.data.fundTxHash,
        hint: timedOut
          ? 'Fund transaction is still pending. Open the explorer and retry confirmation once it confirms.'
          : undefined,
      },
      { status: timedOut ? 504 : 500 },
    )
  }
}
