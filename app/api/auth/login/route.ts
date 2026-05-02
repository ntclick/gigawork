import { NextResponse } from 'next/server'
import { z } from 'zod'

import { setWalletCookie } from '@/lib/auth/session'
import { getOrCreateUser } from '@/lib/credits/service'

const Body = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid evm address'),
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }
  const wallet = parsed.data.wallet.toLowerCase()

  // Set the cookie BEFORE touching the DB. If Supabase is slow / cold /
  // briefly unreachable, getOrCreateUser used to throw and the cookie was
  // never set — that's how every /api/me, /api/workflows call ended up
  // 401 even though Privy login had succeeded. Now the session cookie
  // sticks unconditionally; the user row is created lazily on the first
  // /api/me hit (which will retroactively grant the 300cr signup).
  await setWalletCookie(wallet)

  try {
    const user = await getOrCreateUser(wallet)
    return NextResponse.json({ id: user.id, wallet: user.wallet, credits: user.credits })
  } catch (e) {
    console.warn(
      '[/api/auth/login] cookie set but DB user create failed — will retry on /api/me',
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { wallet, credits: 0, deferred: true },
      { status: 200 },
    )
  }
}
