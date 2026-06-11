import { NextResponse } from 'next/server'
import { and, isNotNull, isNull } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { prefundUserWallet } from '@/lib/credits/postMintHooks'
import { users } from '@/lib/db/schema'

/**
 * POST /api/admin/prefund-backfill
 *
 * One-shot admin tool to ship starter native gas + USDC to every user that
 * minted their ERC-8004 NFT BEFORE Plan A's `prefundUserWallet` hook was
 * wired into /api/identity/confirm. Idempotent — `users.prefunded_at` gates
 * each user, so re-running this is safe.
 *
 * Auth: gated by env `ADMIN_MIGRATE_TOKEN` (same convention as the existing
 * /api/admin/migrate route). Header: `x-admin-token`. Without the token set
 * server-side, the route refuses to run at all.
 *
 * Why a manual backfill instead of triggering on next login: pre-fund spends
 * real USDC from the admin wallet, so we want a single deliberate action
 * (one curl) instead of an opportunistic side-effect that could drain admin
 * if dozens of legacy users hit /api/me at the same time.
 */
export async function POST(req: Request) {
  const expected = process.env.ADMIN_MIGRATE_TOKEN
  if (!expected) {
    return NextResponse.json(
      { error: 'admin_token_unset', detail: 'set ADMIN_MIGRATE_TOKEN to enable backfill' },
      { status: 503 },
    )
  }

  const token = req.headers.get('x-admin-token')
  if (token !== expected) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (process.env.PREFUND_AFTER_MINT !== '1') {
    return NextResponse.json(
      { error: 'prefund_disabled', detail: 'set PREFUND_AFTER_MINT=1 to backfill' },
      { status: 503 },
    )
  }

  // Find users who minted but never got pre-funded.
  const targets = await db
    .select({ id: users.id, wallet: users.wallet })
    .from(users)
    .where(and(isNotNull(users.identityTokenId), isNull(users.prefundedAt)))
    .limit(50)

  const results: Array<{
    wallet: string
    ok: boolean
    detail?: unknown
  }> = []

  // Run sequentially — admin wallet has a shared nonce, parallel sends would
  // collide. 50/run cap also keeps a runaway loop from emptying the admin
  // wallet in one POST.
  for (const u of targets) {
    try {
      const res = await prefundUserWallet({ userId: u.id, wallet: u.wallet })
      results.push({ wallet: u.wallet, ok: !res.error, detail: res })
    } catch (e) {
      results.push({
        wallet: u.wallet,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const summary = {
    candidates: targets.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  }

  return NextResponse.json({ ok: true, summary, results })
}
