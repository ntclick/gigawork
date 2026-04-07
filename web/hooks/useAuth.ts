'use client'

import { usePrivy, useWallets, useSignMessage } from '@privy-io/react-auth'
import { useEffect, useRef } from 'react'
import { api } from '@/lib/api'

export function useAuth() {
  const { authenticated, user } = usePrivy()
  const { wallets } = useWallets()
  const { signMessage } = useSignMessage()
  const attempted = useRef(false)
  const synced = useRef(false)

  const embedded = wallets.find((w) => w.walletClientType === 'privy')
  const address = embedded?.address || wallets[0]?.address || user?.wallet?.address

  useEffect(() => {
    // Only attempt once per session, regardless of outcome
    if (!authenticated || !address || attempted.current) return
    attempted.current = true

    let cancelled = false

    const sync = async () => {
      try {
        await api.auth.me()
        if (!cancelled) synced.current = true
        return
      } catch {
        // No session, continue to nonce flow
      }

      try {
        const { nonce, message } = await api.auth.nonce(address)
        const { signature } = await signMessage(
          { message },
          { uiOptions: { description: 'Sign in to GigaWork' } }
        )
        await api.auth.verify({ address, signature, nonce })
        if (!cancelled) {
          synced.current = true
          console.log('[Auth] Synced with backend:', address)
        }
      } catch (e: any) {
        console.warn('[Auth] Backend sync failed:', e.message)
        // Do NOT retry — mark as attempted
      }
    }

    sync()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, address])

  return { address, authenticated, synced: synced.current }
}
