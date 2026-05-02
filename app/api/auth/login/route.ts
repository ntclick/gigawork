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
  const user = await getOrCreateUser(wallet)
  await setWalletCookie(wallet)
  return NextResponse.json({ id: user.id, wallet: user.wallet, credits: user.credits })
}
