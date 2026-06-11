import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { failWorkflow } from '@/lib/ai/finalizeWorkflow'
import { ERC8183_ENABLED, ERC8183_USER_CLIENT, openAndFundJob } from '@/lib/chain/agenticCommerce'
import { checkOnChainIdentity, verifyTokenOwnership } from '@/lib/chain/identity'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { messages, users, workflows, type User } from '@/lib/db/schema'
import { emitWorkflowEvent } from '@/lib/workflow/events'

const ERC8183_BUDGET = process.env.ERC8183_BUDGET_USDC ?? '0.05'

const Body = z.object({
  prompt: z.string().min(4).max(4000),
})

/** Extract a maximal-info payload from a thrown error so we can see the
 *  actual Postgres reason (column missing, RLS, type mismatch) in the
 *  response body, not just drizzle's "Failed query" wrapper. */
function errorPayload(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { message: String(e).slice(0, 800) }
  const pg = e as unknown as Record<string, unknown>
  const cause = (pg.cause as Record<string, unknown> | undefined) ?? {}
  const causeMessage = typeof cause.message === 'string' ? cause.message.slice(0, 400) : undefined
  // Walk every own enumerable key on the Error/cause and surface anything
  // serializable. postgres-js attaches its diagnostic fields here.
  const grab = (src: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src)) {
      const v = src[k]
      if (v == null) continue
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[k] = typeof v === 'string' ? v.slice(0, 400) : v
      }
    }
    return out
  }
  return {
    message: e.message.slice(0, 800),
    name: e.name,
    pg_code: cause.code ?? pg.code,
    pg_detail: cause.detail ?? pg.detail,
    pg_hint: cause.hint ?? pg.hint,
    pg_table: cause.table_name ?? pg.table_name,
    pg_column: cause.column_name ?? pg.column_name,
    pg_constraint: cause.constraint_name ?? pg.constraint_name,
    pg_severity: cause.severity ?? pg.severity,
    pg_routine: cause.routine ?? pg.routine,
    cause_message: causeMessage,
    err_keys: Object.keys(pg),
    cause_keys: Object.keys(cause),
    pg_dump: grab(pg),
    cause_dump: grab(cause),
  }
}

export async function POST(req: Request) {
  try {
    return await handlePost(req)
  } catch (e) {
    // Belt-and-suspenders: if anything escapes the inner try/catches,
    // log it and surface as 503 so the home Send button gets a usable
    // error shape instead of a bare 500 with stack trace.
    console.error('[/api/workflow] uncaught', e instanceof Error ? e.stack ?? e.message : e)
    return NextResponse.json(
      {
        error: 'internal',
        message: e instanceof Error ? e.message : 'unknown server error',
      },
      { status: 503 },
    )
  }
}

async function handlePost(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  let user: User
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    console.error('[/api/workflow] auth failed', e)
    return NextResponse.json(
      { error: 'db_unavailable', stage: 'auth', ...errorPayload(e) },
      { status: 503 },
    )
  }

  // Verify cached identityTokenId actually belongs to the current
  // user wallet on chain. The DB cache can lag when the user switches
  // wallets (the previous wallet's NFT stays in the row) — letting a
  // stale token through here would allow workflow creation against a
  // wallet that doesn't actually own the identity, which the ERC-8183
  // contract would reject later anyway. Clearing here keeps the
  // identity gate honest. See /api/me for the same pattern.
  if (user.identityTokenId) {
    const stillOwns = await verifyTokenOwnership(user.identityTokenId, user.wallet)
    if (!stillOwns) {
      const [cleared] = await withDbRetry(
        () =>
          db
            .update(users)
            .set({ identityTokenId: null, identityTxHash: null, identityMintedAt: null })
            .where(eq(users.id, user.id))
            .returning(),
        { label: 'workflow:identity-clear-stale' },
      )
      if (cleared) user = cleared
    }
  }

  if (!user.identityTokenId) {
    // DB cache is empty — fall back to on-chain check. The user may have
    // minted the NFT in a previous session, or just switched to a wallet
    // that already owns one (eg minted from a different frontend). This
    // is the same auto-sync logic /api/me runs, so the workflow gate
    // doesn't reject a legit user just because their DB cache hasn't
    // been hydrated yet. Persist the tokenId we find so subsequent
    // requests hit the fast DB path.
    const onChainTokenId = await checkOnChainIdentity(user.wallet)
    if (onChainTokenId) {
      const [updated] = await withDbRetry(
        () =>
          db
            .update(users)
            .set({ identityTokenId: onChainTokenId })
            .where(eq(users.id, user.id))
            .returning(),
        { label: 'workflow:identity-sync' },
      )
      if (updated) user = updated
    }
  }

  if (!user.identityTokenId) {
    return NextResponse.json(
      {
        error: 'identity_required',
        standard: 'ERC-8004',
        message: 'Mint your ERC-8004 identity NFT before posting an ERC-8183 job.',
      },
      { status: 403 },
    )
  }

  let wf: typeof workflows.$inferSelect
  try {
    const initialStatus = ERC8183_ENABLED && ERC8183_USER_CLIENT ? 'awaiting_fund' : 'planning'
    const [created] = await withDbRetry(
      () => db
        .insert(workflows)
        .values({ prompt: parsed.data.prompt, userId: user.id, status: initialStatus })
        .returning(),
      { label: 'workflow:create' },
    )
    if (!created) throw new Error('workflow insert returned no row')
    wf = created

    await withDbRetry(
      () => db.insert(messages).values({
        workflowId: wf.id,
        role: 'user',
        content: parsed.data.prompt,
      }),
      { label: 'workflow:seed-message' },
    )

    await emitWorkflowEvent({
      workflowId: wf.id,
      type: 'workflow.created',
      status: initialStatus,
      message: 'Workflow created',
      payload: {
        promptPreview: parsed.data.prompt.slice(0, 160),
        escrowEnabled: ERC8183_ENABLED,
        escrowUserClient: ERC8183_USER_CLIENT,
      },
    })
    if (!ERC8183_ENABLED || ERC8183_USER_CLIENT) {
      await emitWorkflowEvent({
        workflowId: wf.id,
        type: 'workflow.planning_started',
        status: initialStatus,
        message: initialStatus === 'awaiting_fund'
          ? 'Waiting for escrow funding before planning'
          : 'Planning workflow',
      })
    }

  } catch (e) {
    console.error('[/api/workflow] db insert failed', e)
    return NextResponse.json(
      { error: 'db_unavailable', ...errorPayload(e) },
      { status: 503 },
    )
  }

  // Open + fund a real ERC-8183 job for this workflow when enabled.
  // Failure here MUST NOT block the workflow — the off-chain pipeline can
  // still produce a useful report, we just lose the on-chain trail.
  //
  // Two modes:
  //  - ERC8183_USER_CLIENT=1 → user's Privy wallet drives 3 sigs from the
  //    home page via useEscrowPost. The backend tells the frontend to start
  //    that flow by returning escrow:'user-client' below; admin does NOT
  //    fire openAndFundJob here.
  //  - ERC8183_USER_CLIENT=0 (legacy) → admin self-loops 4 tx.
  let escrowMode: 'user-client' | 'admin' | 'off' = 'off'
  if (ERC8183_ENABLED) {
    if (ERC8183_USER_CLIENT) {
      escrowMode = 'user-client'
      await emitWorkflowEvent({
        workflowId: wf.id,
        type: 'erc8183.awaiting_user_funding',
        status: 'awaiting_fund',
        message: 'Waiting for the user wallet to open and fund escrow',
        payload: { budgetUsdc: ERC8183_BUDGET },
      })
      // Frontend will POST to /api/workflow/escrow/prepare next.
    } else {
      escrowMode = 'admin'
      try {
        await db.update(workflows).set({ status: 'funding' }).where(eq(workflows.id, wf.id))
        await emitWorkflowEvent({
          workflowId: wf.id,
          type: 'erc8183.funding_started',
          status: 'funding',
          message: 'Opening and funding ERC-8183 escrow job',
          payload: { budgetUsdc: ERC8183_BUDGET },
        })
        const res = await openAndFundJob({
          description: `GigaWork workflow ${wf.id}: ${parsed.data.prompt.slice(0, 96)}`,
          budgetUsdc: ERC8183_BUDGET,
        })
        if (!res) throw new Error('openAndFundJob returned null')
        await db
          .update(workflows)
          .set({
            status: 'planning',
            erc8183JobId: res.jobId,
            erc8183CreateTx: res.createTx,
            erc8183SetBudgetTx: res.setBudgetTx,
            erc8183ApproveTx: res.approveTx,
            erc8183FundTx: res.fundTx,
            erc8183BudgetUsdc: res.budgetUsdc,
          })
          .where(eq(workflows.id, wf.id))
        await emitWorkflowEvent({
          workflowId: wf.id,
          type: 'erc8183.funded',
          status: 'planning',
          message: 'ERC-8183 escrow funded; workflow can plan',
          txHash: res.fundTx,
          payload: {
            jobId: res.jobId,
            createTx: res.createTx,
            setBudgetTx: res.setBudgetTx,
            approveTx: res.approveTx,
            fundTx: res.fundTx,
            budgetUsdc: res.budgetUsdc,
          },
        })
        await emitWorkflowEvent({
          workflowId: wf.id,
          type: 'workflow.planning_started',
          status: 'planning',
          message: 'Planning workflow after escrow funding',
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.warn('[workflow] ERC-8183 open+fund failed', message)
        await failWorkflow(wf.id, user.id)
        return NextResponse.json(
          { error: 'escrow_fund_failed', message },
          { status: 503 },
        )
      }
    }
  }

  return NextResponse.json({ id: wf.id, userId: user.id, escrow: escrowMode })
}
