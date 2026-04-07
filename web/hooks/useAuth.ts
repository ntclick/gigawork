'use client'

import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useEffect, useRef } from 'react'
import { api } from '@/lib/api'

export function useAuth() {
  const { authenticated, user } = usePrivy()
  const { wallets } = useWallets()
  const attempted = useRef(false)
  const synced = useRef(false)

  const embedded = wallets.find((w) => w.walletClientType === 'privy')
  const address = embedded?.address || wallets[0]?.address || user?.wallet?.address

  useEffect(() => {
    if (!authenticated || !address || attempted.current) return
    attempted.current = true

    // Just check if we have an existing session — don't auto-trigger sign message.
    // Backend auth is optional; most endpoints are public.
    api.auth.me()
      .then(() => { synced.current = true })
      .catch(() => { /* no session, that's fine */ })
  }, [authenticated, address])

  return { address, authenticated, synced: synced.current }
}
