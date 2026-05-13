import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { workflows } from '@/lib/db/schema'

const Body = z.object({ workflowId: z.string().uuid() })

/**
 * POST /api/workflow/escrow/bypass
 *
 * Lets the workflow skip ERC-8183 user-client funding and go directly to
 * 'planning' so Hermes can run without blockchain escrow.
 *
 * Only works when the workflow is in awaiting_fund or funding state.
 * Clears partial escrow hashes so the row is clean.
 */
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

  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, parsed.data.workflowId))
    .limit(1)

  if (!wf) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (wf.userId !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const allowed = ['awaiting_fund', 'funding', 'planning']
  if (!allowed.includes(wf.status ?? '')) {
    return NextResponse.json(
      { error: 'invalid_state', detail: `Cannot bypass from status: ${wf.status}` },
      { status: 400 },
    )
  }

  // Already past escrow or already planning — no-op
  if (wf.status === 'planning') {
    return NextResponse.json({ ok: true, already: true })
  }

  await db
    .update(workflows)
    .set({
      status: 'planning',
      // Clear any partial escrow state so the row is clean
      erc8183CreateTx: wf.erc8183CreateTx ?? null,
      erc8183JobId: null,
      erc8183SetBudgetTx: null,
      erc8183ApproveTx: null,
      erc8183FundTx: null,
    })
    .where(eq(workflows.id, wf.id))

  console.log(`[escrow/bypass] workflow ${wf.id} bypassed escrow by user ${user.id}`)

  return NextResponse.json({ ok: true })
}
