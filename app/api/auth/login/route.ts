import { NextResponse } from 'next/server'
import { z } from 'zod'

import { setSessionCookie } from '@/lib/auth/session'
import { getOrCreateUser, getOrCreateUserByPrivy } from '@/lib/credits/service'

const Body = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid evm address'),
  // Privy DID — when provided, takes precedence over wallet for identity
  // resolution. This is what lets a single user switch external wallet
  // accounts (eg OKX → MetaMask, or OKX-account-1 → OKX-account-2)
  // without losing their workflows. Frontend (WalletPill) sends both
  // every time Privy reports a wallet/account change.
  privyId: z.string().min(1).optional(),
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }
  const wallet = parsed.data.wallet.toLowerCase()
  const privyId = parsed.data.privyId
  console.log('[/api/auth/login] payload', { wallet, privyId: privyId ?? '(missing)' })

  // Cookie is set BEFORE the DB upsert so transient Supabase issues
  // don't 401 the user; lazy /api/me will resolve the user row on
  // first read.
  await setSessionCookie({ wallet, privyId })

  try {
    const user = privyId
      ? await getOrCreateUserByPrivy(privyId, wallet)
      : await getOrCreateUser(wallet)
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
