'use client'

/**
 * useActiveWallet — single source of truth for "which wallet does the
 * user want to sign with right now?".
 *
 * Privy `useWallets()` only returns wallets that the user has LINKED to
 * their Privy account. If the user logged in via email (creating an
 * embedded wallet) and never explicitly linked their external wallet,
 * Privy doesn't see the external one even when it's open in the user's
 * browser extension. To pull an external wallet in, call
 * `usePrivy().linkWallet()` from a UI affordance (WalletPill exposes
 * "Link wallet").
 *
 * Rule:
 *   1. If wallets[] contains an external wallet → prefer it. External
 *      wallets are a deliberate user choice; signing should land there.
 *   2. Otherwise → embedded (or whatever wallets[0] is).
 *   3. Empty wallets[] → null.
 *
 * No canonical-pinning anymore: server now bumps users.wallet to
 * whoever signed createJob, so wallet swaps mid-session work
 * end-to-end without the client needing to wait for cache match.
 *
 * All on-chain signing call sites (mint, escrow, validation) must use
 * THIS helper, not `wallets[0]` directly.
 */
import { useMemo } from 'react'
import { useWallets } from '@privy-io/react-auth'

export type ActiveWallet = ReturnType<typeof useWallets>['wallets'][number]

export function useActiveWallet(): ActiveWallet | null {
  const { wallets } = useWallets()
  return useMemo(() => {
    if (wallets.length === 0) return null
    const external = wallets.find(
      (w) => (w as { walletClientType?: string }).walletClientType !== 'privy',
    )
    return external ?? wallets[0]
  }, [wallets])
}
