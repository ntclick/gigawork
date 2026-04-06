'use client'

import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useCallback, useMemo } from 'react'
import { ethers } from 'ethers'

export function useWallet() {
  const { authenticated, user, login, logout } = usePrivy()
  const { wallets } = useWallets()

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy')
  const externalWallet = wallets.find((w) => w.walletClientType !== 'privy')
  const activeWallet = embeddedWallet || externalWallet

  const address = activeWallet?.address || user?.wallet?.address

  const getProvider = useCallback(async () => {
    if (!activeWallet) return null
    try {
      await activeWallet.switchChain(5042002)
    } catch {
      // Chain switch failed — continue anyway
    }
    const provider = await activeWallet.getEthereumProvider()
    return new ethers.BrowserProvider(provider)
  }, [activeWallet])

  const getSigner = useCallback(async () => {
    const provider = await getProvider()
    if (!provider) return null
    return provider.getSigner()
  }, [getProvider])

  return {
    address,
    isConnected: authenticated && !!address,
    walletType: embeddedWallet ? 'embedded' : externalWallet ? 'external' : null,
    login,
    logout,
    getProvider,
    getSigner,
    user,
  }
}
