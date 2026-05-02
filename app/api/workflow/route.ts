import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { ERC8183_ENABLED, openAndFundJob } from '@/lib/chain/agenticCommerce'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { messages, workflows } from '@/lib/db/schema'

const ERC8183_BUDGET = process.env.ERC8183_BUDGET_USDC ?? '0.05'

const Body = z.object({
  prompt: z.string().min(4).max(4000),
})

export async function POST(req: Request) {
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

  const [wf] = await withDbRetry(
    () => db
      .insert(workflows)
      .values({ prompt: parsed.data.prompt, userId: user.id })
      .returning(),
    { label: 'workflow:create' },
  )

  await withDbRetry(
    () => db.insert(messages).values({
      workflowId: wf.id,
      role: 'user',
      content: parsed.data.prompt,
    }),
    { label: 'workflow:seed-message' },
  )

  // Open + fund a real ERC-8183 job for this workflow when enabled.
  // Failure here MUST NOT block the workflow — the off-chain pipeline can
  // still produce a useful report, we just lose the on-chain trail.
  if (ERC8183_ENABLED) {
    openAndFundJob({
      description: `GigaWork workflow ${wf.id}: ${parsed.data.prompt.slice(0, 96)}`,
      budgetUsdc: ERC8183_BUDGET,
    })
      .then(async (res) => {
        if (!res) return
        await db
          .update(workflows)
          .set({
            erc8183JobId: res.jobId,
            erc8183CreateTx: res.createTx,
            erc8183FundTx: res.fundTx,
            erc8183BudgetUsdc: res.budgetUsdc,
          })
          .where(eq(workflows.id, wf.id))
      })
      .catch((e) => {
        console.warn('[workflow] ERC-8183 open+fund failed', e instanceof Error ? e.message : e)
      })
  }

  return NextResponse.json({ id: wf.id, userId: user.id })
}
