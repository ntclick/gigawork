'use client'

/**
 * useActiveWallet — single source of truth for "which wallet does the
 * user want to sign with right now?".
 *
 * Privy `useWallets()` returns ALL connected wallets in a Privy account:
 * the auto-created embedded wallet (walletClientType === 'privy') AND
 * any external wallets the user explicitly linked (OKX, MetaMask, Rabby,
 * Phantom, …). Order is implementation-dependent and can flap between
 * renders, and external wallets hydrate later than the embedded one on
 * fresh page mount (~500ms-2s lag).
 *
 * Resolution rule (in priority order):
 *   1. CANONICAL MATCH — if we know the user's server-side canonical
 *      wallet (cached me.wallet, written by WalletPill after /api/me),
 *      return the entry in wallets[] whose address matches that. This
 *      pins NFT lookups + signing to the wallet the server thinks the
 *      user owns, regardless of Privy's wallets[] order.
 *   2. CANONICAL PENDING — canonical is known but its wallet isn't yet
 *      hydrated in wallets[] (the OKX-not-ready race that the escrow
 *      auto-fire used to trip). Return null so callers WAIT instead of
 *      silently falling back to the embedded wallet and signing under
 *      the wrong address.
 *   3. NO CANONICAL — first-time user, no cache. Prefer any external
 *      wallet, else the embedded one.
 *
 * All on-chain signing call sites (mint, escrow, validation) must use
 * THIS helper, not `wallets[0]` directly.
 */
import { useMemo } from 'react'
import { useWallets } from '@privy-io/react-auth'

import { readMeCache } from '@/lib/identityCache'

export type ActiveWallet = ReturnType<typeof useWallets>['wallets'][number]

export function useActiveWallet(): ActiveWallet | null {
  const { wallets } = useWallets()
  return useMemo(() => {
    if (wallets.length === 0) return null

    // Inspect every cached me entry — we don't know which wallet the
    // user is "on" yet, so probe every wallet's address against its own
    // me cache. The cache is keyed by wallet, so for each wallet in
    // wallets[] we check its entry. If any cached entry's `wallet`
    // matches itself (sanity) AND is the most recently cached, treat
    // that as canonical.
    let canonical: string | null = null
    let canonicalAt = -1
    for (const w of wallets) {
      const cached = readMeCache(w.address)
      if (!cached) continue
      const matches = cached.wallet?.toLowerCase() === w.address.toLowerCase()
      if (matches && cached.cachedAt > canonicalAt) {
        canonical = w.address.toLowerCase()
        canonicalAt = cached.cachedAt
      }
    }

    // No cache hit on any present wallet — also probe the global cache
    // for any wallet, even one that hasn't hydrated yet. We can't
    // return it (not in wallets[]), but knowing it exists tells us
    // "wait, don't fall back to embedded".
    if (!canonical && typeof window !== 'undefined') {
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i)
          if (!k || !k.startsWith('gw:me:')) continue
          const raw = window.localStorage.getItem(k)
          if (!raw) continue
          const parsed = JSON.parse(raw) as {
            wallet?: string
            cachedAt?: number
          }
          if (parsed.wallet && (parsed.cachedAt ?? 0) > canonicalAt) {
            canonical = parsed.wallet.toLowerCase()
            canonicalAt = parsed.cachedAt ?? 0
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (canonical) {
      const match = wallets.find(
        (w) => w.address.toLowerCase() === canonical,
      )
      if (match) return match
      // Canonical wallet known but not hydrated yet. WAIT — returning
      // null forces callers to either show a spinner or block their
      // auto-fire. Better than silently signing under the embedded
      // wallet and tripping the server-side signer-mismatch check.
      return null
    }

    // First-time user / no canonical recorded yet. Prefer any external
    // wallet, else the embedded one.
    const external = wallets.find(
      (w) => (w as { walletClientType?: string }).walletClientType !== 'privy',
    )
    return external ?? wallets[0]
  }, [wallets])
}
