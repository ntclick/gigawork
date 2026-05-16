import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { ERC8183_USER_CLIENT, verifyApproveAndFund } from '@/lib/chain/agenticCommerce'
import { publicClient } from '@/lib/chain/client'
import { db } from '@/lib/db/client'
import { workflows } from '@/lib/db/schema'

const TxHash = z.string().regex(/^0x[a-fA-F0-9]{64}$/)

const Body = z.object({
  workflowId: z.string().uuid(),
  approveTxHash: z.union([TxHash, z.literal('0x0')]),
  fundTxHash: TxHash,
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
  // Idempotency marker: use the workflow's status, NOT the fundTx hash.
  // /api/workflow/escrow/track writes fundTx into the row before this
  // confirm endpoint runs (so the trail UI can light up the "Fund escrow"
  // step optimistically). Bailing on `wf.erc8183FundTx` would short-circuit
  // here without ever flipping status from 'funding' → 'planning',
  // permanently stranding the workflow because the frontend's auto-send
  // gate requires status==='planning' to trigger Hermes.
  if (wf.status === 'planning' || wf.status === 'completed' || wf.status === 'settling') {
    return NextResponse.json({
      ok: true,
      already: true,
      fundTx: wf.erc8183FundTx,
    })
  }

  // Canonical signer for THIS job is whoever signed createJob, not
  // user.wallet (which can be re-bumped by parallel auth-sync calls).
  // Derive it from the persisted createTx receipt — that hash is
  // immutable for the life of the workflow row.
  let canonicalSigner: `0x${string}` = user.wallet.toLowerCase() as `0x${string}`
  if (wf.erc8183CreateTx) {
    try {
      const createTx = await publicClient.getTransaction({
        hash: wf.erc8183CreateTx as `0x${string}`,
      })
      canonicalSigner = createTx.from.toLowerCase() as `0x${string}`
    } catch (e) {
      console.warn(
        '[escrow/confirm] failed to read createTx, falling back to user.wallet',
        e instanceof Error ? e.message : e,
      )
    }
  }

  try {
    await verifyApproveAndFund({
      approveTxHash: parsed.data.approveTxHash as `0x${string}`,
      fundTxHash: parsed.data.fundTxHash as `0x${string}`,
      expectedClient: canonicalSigner,
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
