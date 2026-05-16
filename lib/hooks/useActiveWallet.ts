'use client'

/**
 * useActiveWallet — single source of truth for "which wallet does the
 * user want to sign with right now?".
 *
 * Privy `useWallets()` returns ALL connected wallets in a Privy account:
 * the auto-created embedded wallet (walletClientType === 'privy') AND
 * any external wallets the user explicitly linked (OKX, MetaMask, Rabby,
 * Phantom, …). Order is implementation-dependent and can flap between
 * renders when multiple wallets are active.
 *
 * Rule we enforce:
 *   1. If the user has connected an EXTERNAL wallet, prefer that — it's
 *      a deliberate user choice ("I want NFTs/credits in MY external
 *      wallet, not the Privy custodial embedded one").
 *   2. Otherwise fall back to the Privy embedded wallet (created on
 *      email/social login).
 *   3. If nothing connected, return null.
 *
 * All on-chain signing call sites (mint, escrow, validation) must use
 * THIS helper, not `wallets[0]` directly — otherwise users who linked
 * OKX after an email login still see things sent to the embedded one.
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
