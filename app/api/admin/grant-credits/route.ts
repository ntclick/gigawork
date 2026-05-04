/**
 * /api/admin/grant-credits — admin top-up. POST { wallet, amount } and the
 * wallet's user row gets a fresh credit grant + ledger row. Token-gated.
 */
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { grantCredits, getOrCreateUser } from '@/lib/credits/service'

export async function POST(req: Request) {
  const guard =
    req.headers.get('x-migrate-token') ??
    new URL(req.url).searchParams.get('token') ??
    ''
  if (guard !== (process.env.MIGRATE_TOKEN ?? 'dev-migrate')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    wallet?: string
    amount?: number
  }
  if (!body.wallet || !body.amount || body.amount <= 0) {
    return NextResponse.json(
      { error: 'missing_params', need: '{ wallet, amount: positive int }' },
      { status: 400 },
    )
  }

  const user = await getOrCreateUser(body.wallet.toLowerCase())
  const result = await grantCredits({
    userId: user.id,
    amount: Math.floor(body.amount),
    reason: 'admin_grant',
  })

  const [refreshed] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
  return NextResponse.json({
    ok: true,
    wallet: refreshed?.wallet,
    credits: result.balance,
  })
}
