import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { ERC8183_USER_CLIENT, prepareOpenAndFund } from '@/lib/chain/agenticCommerce'
import { arcTestnet } from '@/lib/chain/client'
import { db } from '@/lib/db/client'
import { workflows } from '@/lib/db/schema'

const Body = z.object({
  workflowId: z.string().uuid(),
})

const ERC8183_BUDGET = process.env.ERC8183_BUDGET_USDC ?? '0.05'

/**
 * POST /api/workflow/escrow/prepare
 *
 * Step 1 of the user-as-client ERC-8183 flow. Returns the calldata blobs the
 * user's Privy wallet must sign for `createJob` and `approve`. Fund calldata
 * is NOT returned here because it requires the jobId from the createJob
 * receipt — that's handled by /post-create after the create tx confirms.
 *
 * Auth: cookie-based getCurrentUser. Workflow must belong to the caller and
 * not already have an erc8183_job_id (idempotent — re-clicks short-circuit).
 */
export async function POST(req: Request) {
  if (!ERC8183_USER_CLIENT) {
    return NextResponse.json(
      { error: 'feature_disabled', detail: 'set ERC8183_USER_CLIENT=1 to enable' },
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

  try {
    const bundle = await prepareOpenAndFund({
      clientAddress: user.wallet as `0x${string}`,
      description: `GigaWork workflow ${wf.id}: ${wf.prompt.slice(0, 96)}`,
      budgetUsdc: ERC8183_BUDGET,
    })
    if (!bundle) {
      // Either ERC8183_USER_CLIENT off (already filtered above) or admin not
      // configured — without admin, setBudget can't run later anyway.
      return NextResponse.json(
        { error: 'admin_unconfigured', detail: 'ADMIN_PRIVATE_KEY missing on server' },
        { status: 503 },
      )
    }

    if (wf.erc8183JobId || wf.erc8183CreateTx) {
      // Idempotent resume. Include createJob calldata so the hook can resume
      // funding when erc8183FundTx is still null (user never completed funding).
      return NextResponse.json({
        ok: true,
        already: true,
        workflowId: wf.id,
        chainId: arcTestnet.id,
        contract: bundle.contract,
        usdcContract: bundle.usdcContract,
        budget: bundle.budget,
        budgetUsdc: bundle.budgetUsdc,
        allowance: bundle.allowance,
        approvalRequired: bundle.approvalRequired,
        approvalAmount: bundle.approvalAmount,
        expiredAt: bundle.expiredAt,
        description: bundle.description,
        provider: bundle.provider,
        evaluator: bundle.evaluator,
        hook: bundle.hook,
        jobId: wf.erc8183JobId,
        createTx: wf.erc8183CreateTx,
        setBudgetTx: wf.erc8183SetBudgetTx,
        approveTx: wf.erc8183ApproveTx ?? (bundle.approvalRequired ? null : '0x0'),
        fundTx: wf.erc8183FundTx,
        // Always include createJob so hook can restart from signing-create if needed
        createJob: { to: bundle.createJob.to, data: bundle.createJob.data },
        approve: bundle.approve ? { to: bundle.approve.to, data: bundle.approve.data } : null,
      })
    }

    return NextResponse.json({
      ok: true,
      workflowId: wf.id,
      chainId: arcTestnet.id,
      contract: bundle.contract,
      usdcContract: bundle.usdcContract,
      budget: bundle.budget,
      budgetUsdc: bundle.budgetUsdc,
      allowance: bundle.allowance,
      approvalRequired: bundle.approvalRequired,
      approvalAmount: bundle.approvalAmount,
      expiredAt: bundle.expiredAt,
      description: bundle.description,
      provider: bundle.provider,
      evaluator: bundle.evaluator,
      hook: bundle.hook,
      // Client calldata. Approve is null when existing allowance is enough.
      createJob: { to: bundle.createJob.to, data: bundle.createJob.data },
      approveTx: bundle.approvalRequired ? undefined : '0x0',
      approve: bundle.approve ? { to: bundle.approve.to, data: bundle.approve.data } : null,
      // fund calldata returned later via /post-create once jobId is known
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[escrow/prepare] failed', msg)
    return NextResponse.json(
      { error: 'prepare_failed', detail: msg },
      { status: 500 },
    )
  }
}
