'use client'

import { usePrivy, useWallets, useSignMessage } from '@privy-io/react-auth'
import { useCallback, useEffect, useRef } from 'react'
import { api } from '@/lib/api'

export function useAuth() {
  const { authenticated, user } = usePrivy()
  const { wallets } = useWallets()
  const { signMessage } = useSignMessage()
  const synced = useRef(false)

  // Prefer embedded wallet, fallback to external
  const embedded = wallets.find((w) => w.walletClientType === 'privy')
  const address = embedded?.address || wallets[0]?.address || user?.wallet?.address

  // Sync with backend after Privy login
  const syncWithBackend = useCallback(async () => {
    if (!address || synced.current) return
    try {
      // Try existing session first
      await api.auth.me()
      synced.current = true
      return
    } catch {
      // No session — need to auth
    }

    try {
      // Get nonce
      const { nonce, message } = await api.auth.nonce(address)

      // Sign with Privy (uses embedded wallet automatically, no MetaMask popup)
      const { signature } = await signMessage(
        { message },
        { uiOptions: { description: 'Sign in to GigaWork' } }
      )

      // Verify with backend
      await api.auth.verify({ address, signature, nonce })
      synced.current = true
      console.log('[Auth] Synced with backend:', address)
    } catch (e: any) {
      console.warn('[Auth] Backend sync failed:', e.message)
    }
  }, [address, signMessage])

  useEffect(() => {
    if (authenticated && address) {
      syncWithBackend()
    }
  }, [authenticated, address, syncWithBackend])

  return { address, authenticated, synced: synced.current }
}
