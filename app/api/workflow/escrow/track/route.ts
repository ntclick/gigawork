import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { ERC8183_USER_CLIENT } from '@/lib/chain/agenticCommerce'
import { db } from '@/lib/db/client'
import { workflows } from '@/lib/db/schema'

const TxHash = z.string().regex(/^0x[a-fA-F0-9]{64}$/)

const Body = z.object({
  workflowId: z.string().uuid(),
  createJobTxHash: TxHash.optional(),
  approveTxHash: TxHash.optional(),
  fundTxHash: TxHash.optional(),
})

export async function POST(req: Request) {
  if (!ERC8183_USER_CLIENT) {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 503 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  if (!parsed.data.createJobTxHash && !parsed.data.approveTxHash && !parsed.data.fundTxHash) {
    return NextResponse.json({ error: 'no_tx_hashes' }, { status: 400 })
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

  await db
    .update(workflows)
    .set({
      status: 'funding',
      erc8183CreateTx: parsed.data.createJobTxHash ?? wf.erc8183CreateTx,
      erc8183ApproveTx: parsed.data.approveTxHash ?? wf.erc8183ApproveTx,
      erc8183FundTx: parsed.data.fundTxHash ?? wf.erc8183FundTx,
    })
    .where(eq(workflows.id, wf.id))

  return NextResponse.json({ ok: true })
}
