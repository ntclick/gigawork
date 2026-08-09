'use client'

/**
 * SessionSync — headless. Keeps the server session cookie pointed at the
 * wallet the user is actually signing with.
 *
 * Every API route resolves the user via `getCurrentUser()` reading the
 * `gw_wallet` / `gw_privy_id` cookies. Without this sync, every request
 * 401s — so this must mount in the layout (not per page) and survive
 * client-side navigation between surfaces.
 *
 * The address comes from `useActiveWallet()`, which prefers an external
 * wallet (OKX/MetaMask) over the Privy embedded one — the same rule every
 * signing call site uses. If the cookie tracked a different address than
 * the signer, server-side signer verification would reject mints and
 * escrow transactions.
 */
import { useEffect, useRef } from 'react'
import { usePrivy } from '@privy-io/react-auth'

import { useActiveWallet } from '@/lib/hooks/useActiveWallet'

export function SessionSync() {
  const { ready, authenticated, user } = usePrivy()
  const wallet = useActiveWallet()
  const syncedKeyRef = useRef<string | null>(null)

  const address = wallet?.address?.toLowerCase() ?? null
  const privyId = user?.id ?? null

  useEffect(() => {
    if (!ready) return

    // Key on both dimensions so switching either the Privy account or the
    // active extension account re-syncs.
    const key = address ? `${privyId ?? '-'}|${address}` : null

    if (key && key !== syncedKeyRef.current) {
      syncedKeyRef.current = key
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, ...(privyId ? { privyId } : {}) }),
        credentials: 'same-origin',
      })
        .then((r) => {
          if (!r.ok) {
            // Let the next render retry rather than sticking on a bad sync.
            if (syncedKeyRef.current === key) syncedKeyRef.current = null
            return
          }
          window.dispatchEvent(new CustomEvent('gw:session-ready'))
          window.dispatchEvent(new CustomEvent('gw:credits-changed'))
        })
        .catch(() => {
          if (syncedKeyRef.current === key) syncedKeyRef.current = null
        })
    }

    if (!authenticated && syncedKeyRef.current) {
      syncedKeyRef.current = null
      fetch('/api/auth/logout', { method: 'POST' })
        .then(() => window.dispatchEvent(new CustomEvent('gw:credits-changed')))
        .catch(() => {})
    }
  }, [ready, authenticated, address, privyId])

  return null
}
