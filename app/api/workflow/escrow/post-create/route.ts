import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { createPublicClient, http } from 'viem'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import {
  ERC8183_USER_CLIENT,
  encodeFundForJob,
  setBudgetByAdmin,
} from '@/lib/chain/agenticCommerce'
import { arcTestnet, pollingClient } from '@/lib/chain/client'
import { db } from '@/lib/db/client'
import { users, workflows } from '@/lib/db/schema'

// Arc Testnet public RPC propagation is uneven — a tx broadcast through
// one node can take 30-90s to appear on another. Rotate through the same
// public RPCs that viem's built-in arcTestnet chain uses (plus drpc and
// the ARC_RPC_URL/NEXT_PUBLIC_ARC_RPC env overrides for Alchemy) so a
// single laggy node doesn't trigger a false-positive "tx missing" reset.
// Matches the load-balanced pattern in scripts/onchain/full-flow-8183.ts.
const ARC_FALLBACK_RPCS = [
  'https://rpc.testnet.arc.network',
  'https://rpc.quicknode.testnet.arc.network',
  'https://rpc.blockdaemon.testnet.arc.network',
  'https://rpc.drpc.testnet.arc.network',
  process.env.ARC_RPC_URL,
  process.env.NEXT_PUBLIC_ARC_RPC,
].filter((url, i, arr): url is string => !!url && arr.indexOf(url) === i)

const fallbackClients = ARC_FALLBACK_RPCS.map((url) =>
  createPublicClient({ chain: arcTestnet, transport: http(url, { batch: false }) }),
)

async function getReceiptWithFallback(hash: `0x${string}`) {
  try {
    return await pollingClient.getTransactionReceipt({ hash })
  } catch (primaryErr) {
    for (const client of fallbackClients) {
      try {
        return await client.getTransactionReceipt({ hash })
      } catch {
        continue
      }
    }
    throw primaryErr
  }
}

async function getTransactionWithFallback(hash: `0x${string}`) {
  try {
    const tx = await pollingClient.getTransaction({ hash })
    if (tx) return tx
  } catch {
    // fall through to fallbacks
  }
  for (const client of fallbackClients) {
    try {
      const tx = await client.getTransaction({ hash })
      if (tx) return tx
    } catch {
      continue
    }
  }
  return null
}

const Body = z.object({
  workflowId: z.string().uuid(),
  createJobTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  approveTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  createTxFresh: z.boolean().optional(),
  dropMissingTx: z.boolean().optional(),
  budget: z.string().regex(/^\d+$/), // wei string
})

/**
 * POST /api/workflow/escrow/post-create
 *
 * Step 2 of user-as-client ERC-8183 flow. Receives the user's createJob tx
 * hash, extracts the on-chain jobId, then admin-signs setBudget (provider
 * role per Arc reference impl convention). Returns the fund calldata so the
 * user's wallet can sign step 3.
 *
 * The setBudget tx + jobId are persisted to the workflow row immediately —
 * this is the audit trail point where the workflow becomes "fundable".
 * If setBudget reverts (e.g. provider already set price for this jobId
 * somehow), the workflow row is left without erc8183_job_id so the
 * frontend can retry from /prepare cleanly.
 */
export async function POST(req: Request) {
  if (!ERC8183_USER_CLIENT) {
    return NextResponse.json(
      { error: 'feature_disabled' },
      { status: 503 },
    )
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
  if (wf.erc8183JobId) {
    if (parsed.data.approveTxHash && !wf.erc8183ApproveTx) {
      await db
        .update(workflows)
        .set({ erc8183ApproveTx: parsed.data.approveTxHash })
        .where(eq(workflows.id, wf.id))
    }
    // Already past this step — return existing state for idempotent retry
    const fundCalldata = encodeFundForJob(BigInt(wf.erc8183JobId))
    return NextResponse.json({
      ok: true,
      already: true,
      jobId: wf.erc8183JobId,
      createTx: wf.erc8183CreateTx,
      setBudgetTx: wf.erc8183SetBudgetTx,
      approveTx: wf.erc8183ApproveTx,
      fund: { data: fundCalldata },
    })
  }

  try {
    await db
      .update(workflows)
      .set({
        status: 'funding',
        erc8183CreateTx: parsed.data.createJobTxHash,
        erc8183ApproveTx: parsed.data.approveTxHash,
      })
      .where(eq(workflows.id, wf.id))

    let createReceipt
    try {
      createReceipt = await getReceiptWithFallback(
        parsed.data.createJobTxHash as `0x${string}`,
      )
    } catch {
      const pendingTx = await getTransactionWithFallback(
        parsed.data.createJobTxHash as `0x${string}`,
      )

      if (pendingTx) {
        return NextResponse.json(
          {
            ok: false,
            error: 'create_tx_pending',
            detail: 'Create job transaction is still pending confirmation.',
            txHash: parsed.data.createJobTxHash,
            hint: 'Create job is visible on Arc but not mined yet. Keep this workflow open; funding will continue automatically.',
          },
          { status: 202 },
        )
      }

      // Only declare the tx genuinely missing when the frontend explicitly
      // opted-in via dropMissingTx (set true only after a long poll window
      // of NOT seeing the tx — currently 60s). Otherwise keep returning
      // pending so the frontend can keep polling.
      //
      // Arc Testnet RPC propagation lag is the common cause: tx is signed
      // and accepted by the wallet's RPC but the public RPC's view lags
      // 20-40s. Resetting too early forced the user to re-sign and Privy
      // often rejected the back-to-back popup as "user denied".
      if (parsed.data.dropMissingTx) {
        await db
          .update(workflows)
          .set({
            status: 'awaiting_fund',
            erc8183CreateTx: null,
            erc8183ApproveTx: null,
            erc8183SetBudgetTx: null,
          })
          .where(eq(workflows.id, wf.id))

        return NextResponse.json(
          {
            ok: false,
            error: 'create_tx_not_found',
            recoverable: true,
            resetCreateTx: true,
            detail: 'Create job transaction is no longer visible on Arc RPC after 60s.',
            txHash: parsed.data.createJobTxHash,
            hint: 'The wallet returned a hash, but Arc RPC never indexed it. The stale hashes were cleared so the wallet can sign a fresh createJob transaction.',
          },
          { status: 200 },
        )
      }

      return NextResponse.json(
        {
          ok: false,
          error: 'create_tx_pending',
          detail: 'Create job transaction is still pending confirmation.',
          txHash: parsed.data.createJobTxHash,
          txVisible: false,
          hint: 'Create job is not visible on Arc RPC yet. Funding will keep polling.',
        },
        { status: 202 },
      )
    }

    if (createReceipt.status !== 'success') {
      throw new Error(`createJob tx ${parsed.data.createJobTxHash} reverted`)
    }

    const { jobId, setBudgetTx, actualClient } = await setBudgetByAdmin({
      createJobTxHash: parsed.data.createJobTxHash as `0x${string}`,
      expectedClient: user.wallet as `0x${string}`,
      budget: BigInt(parsed.data.budget),
    })

    // "Whichever wallet you connect, that wallet pays" — if the signer
    // differs from the cookie wallet (eg user switched accounts in the
    // extension, or Privy hadn't hydrated their external wallet at
    // pre-sync time), bump users.wallet to the signer. Downstream
    // verifyApproveAndFund + /confirm then expect approve+fund tx
    // signed by the SAME wallet, so the user just keeps signing with
    // whatever they had open.
    if (actualClient !== user.wallet.toLowerCase()) {
      try {
        await db
          .update(users)
          .set({ wallet: actualClient })
          .where(eq(users.id, user.id))
        console.log(
          `[escrow/post-create] bumped users.wallet ${user.wallet} → ${actualClient} (id=${user.id})`,
        )
      } catch (e) {
        console.warn(
          '[escrow/post-create] users.wallet bump failed (non-fatal)',
          e instanceof Error ? e.message : e,
        )
      }
    }

    // Persist trail. erc8183_job_id is the marker that gates re-entry from
    // /prepare; once set, only /confirm can advance the row.
    await db
      .update(workflows)
      .set({
        status: 'funding',
        erc8183JobId: jobId.toString(),
        erc8183CreateTx: parsed.data.createJobTxHash,
        erc8183SetBudgetTx: setBudgetTx,
      })
      .where(eq(workflows.id, wf.id))

    const fundCalldata = encodeFundForJob(jobId)

    return NextResponse.json({
      ok: true,
      jobId: jobId.toString(),
      setBudgetTx,
      fund: { data: fundCalldata },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[escrow/post-create] failed', msg)
    const timedOut = /timed out while waiting for transaction/i.test(msg)
    return NextResponse.json(
      {
        error: timedOut ? 'create_tx_pending' : 'post_create_failed',
        detail: msg,
        txHash: parsed.data.createJobTxHash,
        hint: timedOut
          ? 'Create job transaction is still pending. Open the explorer and retry funding once it confirms.'
          : undefined,
      },
      { status: timedOut ? 504 : 500 },
    )
  }
}
