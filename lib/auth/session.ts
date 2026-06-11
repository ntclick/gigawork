import { cookies } from 'next/headers'
import { getOrCreateUser, getOrCreateUserByPrivy } from '@/lib/credits/service'
import type { User } from '@/lib/db/schema'

const COOKIE_WALLET = 'gw_wallet'
const COOKIE_PRIVY = 'gw_privy_id'

export class AuthRequiredError extends Error {
  readonly code = 'unauthenticated'
  constructor() {
    super('unauthenticated')
    this.name = 'AuthRequiredError'
  }
}

/**
 * Resolves the current user from session cookies. Prefers Privy DID
 * (gw_privy_id) which is stable across wallet switches; falls back to
 * raw wallet address (gw_wallet) for legacy sessions and pre-Privy auth.
 *
 * Throws AuthRequiredError when no usable cookie is present, so
 * unauthenticated requests can never silently read or write data tied
 * to a "default" user.
 *
 * Local dev opt-in: set DEV_WALLET in .env.local to bypass Privy login.
 * Empty/unset = no fallback, even in dev.
 */
export async function getCurrentUser(): Promise<User> {
  const c = await cookies()
  const cookieWallet = c.get(COOKIE_WALLET)?.value
  const cookiePrivyId = c.get(COOKIE_PRIVY)?.value
  const devWallet =
    process.env.NODE_ENV !== 'production' ? process.env.DEV_WALLET : undefined

  // Privy DID path: most accurate — survives wallet switches.
  if (cookiePrivyId && cookieWallet) {
    return await getOrCreateUserByPrivy(cookiePrivyId, cookieWallet)
  }

  // Legacy / dev fallback: wallet-only lookup.
  const wallet = cookieWallet ?? devWallet
  if (!wallet) throw new AuthRequiredError()
  return await getOrCreateUser(wallet)
}

export async function getCurrentUserOrNull(): Promise<User | null> {
  try {
    return await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) return null
    throw e
  }
}

/**
 * Set both wallet + privyId cookies. Either can be present alone;
 * having both is the preferred path (Privy DID drives lookup, wallet
 * tracks the active signing address).
 */
export async function setSessionCookie(opts: {
  wallet: string
  privyId?: string
}): Promise<void> {
  const c = await cookies()
  const opts_base = {
    path: '/',
    httpOnly: false,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  }
  c.set(COOKIE_WALLET, opts.wallet.toLowerCase(), opts_base)
  if (opts.privyId) {
    c.set(COOKIE_PRIVY, opts.privyId, opts_base)
  }
}

/** @deprecated Use setSessionCookie({ wallet, privyId }) instead. */
export async function setWalletCookie(wallet: string): Promise<void> {
  await setSessionCookie({ wallet })
}

/** Clear all session cookies on logout. */
export async function clearSessionCookies(): Promise<void> {
  const c = await cookies()
  c.delete(COOKIE_WALLET)
  c.delete(COOKIE_PRIVY)
}

export const SESSION_COOKIE_NAME = COOKIE_WALLET
export const PRIVY_COOKIE_NAME = COOKIE_PRIVY
