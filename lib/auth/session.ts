import { cookies } from 'next/headers'

import { getOrCreateUser } from '@/lib/credits/service'
import type { User } from '@/lib/db/schema'

const COOKIE_NAME = 'gw_wallet'
const DEV_WALLET = '0xdef0000000000000000000000000000000000001'

/**
 * Resolves the current user from the wallet cookie, falling back to the
 * dev wallet so the app is usable without Privy. Lazily creates the user
 * row on first hit so the signup grant fires once.
 */
export async function getCurrentUser(): Promise<User> {
  const c = await cookies()
  const wallet = c.get(COOKIE_NAME)?.value ?? process.env.DEV_WALLET ?? DEV_WALLET
  return getOrCreateUser(wallet)
}

export async function setWalletCookie(wallet: string): Promise<void> {
  const c = await cookies()
  c.set(COOKIE_NAME, wallet.toLowerCase(), {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
