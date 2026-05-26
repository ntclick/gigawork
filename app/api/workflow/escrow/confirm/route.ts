import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { parseUnits } from 'viem'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { ERC8183_USER_CLIENT, openAndFundJob } from '@/lib/chain/agenticCommerce'
import { publicClient, adminAccount } from '@/lib/chain/client'
import { db } from '@/lib/db/client'
import { workflows } from '@/lib/db/schema'

const TxHash = z.string().regex(/^0x[a-fA-F0-9]{64}$/)

const Body = z.object({
  workflowId: z.string().uuid(),
  paymentTxHash: TxHash,
})

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

  if (wf.status === 'planning' || wf.status === 'completed' || wf.status === 'settling') {
    return NextResponse.json({
      ok: true,
      already: true,
      jobId: wf.erc8183JobId,
      fundTx: wf.erc8183FundTx,
    })
  }

  if (!adminAccount) {
    return NextResponse.json(
      { error: 'admin_unconfigured', detail: 'ADMIN_PRIVATE_KEY missing on server' },
      { status: 503 },
    )
  }

  const paymentHash = parsed.data.paymentTxHash as `0x${string}`

  try {
    // 1. Wait for transaction receipt to ensure it succeeded
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: paymentHash,
      confirmations: 1,
      timeout: 45000,
    })

    if (receipt.status !== 'success') {
      throw new Error('Payment transaction failed on-chain')
    }

    // 2. Fetch the transaction details to verify recipient, sender, and amount
    const tx = await publicClient.getTransaction({ hash: paymentHash })

    if (tx.to?.toLowerCase() !== adminAccount.address.toLowerCase()) {
      throw new Error(`Recipient mismatch: expected ${adminAccount.address}, got ${tx.to}`)
    }

    if (tx.from.toLowerCase() !== user.wallet.toLowerCase()) {
      throw new Error(`Sender mismatch: expected user wallet ${user.wallet}, got ${tx.from}`)
    }

    // Native USDC gas/currency token on Arc Testnet has 18 decimals
    const budgetUsdc = process.env.ERC8183_BUDGET_USDC ?? '0.05'
    const expectedValue = parseUnits(budgetUsdc, 18)

    if (tx.value < expectedValue) {
      throw new Error(`Payment value too low: expected >= ${expectedValue}, got ${tx.value}`)
    }

    // 3. Native payment verified! Open and fund the EIP-8183 escrow job in the background using Admin's funds
    const res = await openAndFundJob({
      description: `GigaWork workflow ${wf.id}: ${wf.prompt.slice(0, 96)}`,
      budgetUsdc,
    })

    if (!res) {
      throw new Error('Escrow creation failed: openAndFundJob returned null')
    }

    await db
      .update(workflows)
      .set({
        status: 'planning',
        erc8183JobId: res.jobId,
        erc8183CreateTx: res.createTx,
        erc8183SetBudgetTx: res.setBudgetTx,
        erc8183ApproveTx: res.approveTx,
        erc8183FundTx: res.fundTx,
        erc8183BudgetUsdc: budgetUsdc,
      })
      .where(eq(workflows.id, wf.id))

    return NextResponse.json({
      ok: true,
      jobId: res.jobId,
      createTx: res.createTx,
      setBudgetTx: res.setBudgetTx,
      approveTx: res.approveTx,
      fundTx: res.fundTx,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[escrow/confirm] failed', msg)
    const timedOut = /timed out while waiting for transaction/i.test(msg)
    return NextResponse.json(
      {
        error: timedOut ? 'payment_tx_pending' : 'confirm_failed',
        detail: msg,
        txHash: paymentHash,
        hint: timedOut
          ? 'Payment transaction is still pending. Open the explorer and retry confirmation once it confirms.'
          : undefined,
      },
      { status: timedOut ? 504 : 500 },
    )
  }
}
