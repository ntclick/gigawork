import { cookies } from 'next/headers'

import { getOrCreateUser } from '@/lib/credits/service'
import type { User } from '@/lib/db/schema'

const COOKIE_NAME = 'gw_wallet'

export class AuthRequiredError extends Error {
  readonly code = 'unauthenticated'
  constructor() {
    super('unauthenticated')
    this.name = 'AuthRequiredError'
  }
}

/**
 * Resolves the current user from the wallet cookie. Throws AuthRequiredError
 * when no cookie is present, so unauthenticated requests can never silently
 * read or write data tied to a "default" user.
 *
 * Local dev opt-in: set DEV_WALLET in .env.local to a wallet address to skip
 * Privy login during development. Empty/unset = no fallback, even in dev.
 */
export async function getCurrentUser(): Promise<User> {
  const c = await cookies()
  const cookieWallet = c.get(COOKIE_NAME)?.value
  const devWallet =
    process.env.NODE_ENV !== 'production' ? process.env.DEV_WALLET : undefined
  const wallet = cookieWallet ?? devWallet
  if (!wallet) throw new AuthRequiredError()
  return getOrCreateUser(wallet)
}

export async function getCurrentUserOrNull(): Promise<User | null> {
  try {
    return await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) return null
    throw e
  }
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
