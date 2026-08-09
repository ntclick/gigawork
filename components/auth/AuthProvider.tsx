'use client'

import React, { useEffect, useState } from 'react'
import { PrivyProvider } from '@privy-io/react-auth'
import { baseSepolia, sepolia } from 'viem/chains'

// Use the shared arcTestnet — has USDC as nativeCurrency, which is what
// external wallets (OKX, MetaMask) need to estimate gas correctly.
// Privy passes this chain config to the wallet popup, so it MUST match.
// See lib/chain/arcTestnet.ts + AGENTS.md §1.
import { arcTestnet } from '@/lib/chain/arcTestnet'

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID
const CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // If in browser and on 127.0.0.1, immediately redirect and don't mount Privy to prevent 403
  if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') {
    window.location.replace(window.location.href.replace('//127.0.0.1', '//localhost'))
    return <>{children}</>
  }

  if (!APP_ID) return <>{children}</>

  return (
    <PrivyProvider
      appId={APP_ID}
      clientId={CLIENT_ID}
      config={{
        loginMethods: ['wallet', 'email'],
        appearance: {
          theme: 'dark',
          accentColor: '#22d3ee',
          showWalletLoginFirst: true,
        },
        // No embedded wallet creation, ever. The user's connected
        // external wallet (OKX/MetaMask/…) is the canonical wallet —
        // we never want Privy to mint a custodial embedded wallet
        // that shadows the user's real wallet in the pill.
        // If the user logs in via email only and never links a wallet,
        // the WalletPill prompts them to "Link external wallet" before
        // any signing can happen.
        embeddedWallets: {
          ethereum: { createOnLogin: 'off' },
        },
        // Force Coinbase Wallet to EOA mode. Smart Wallet hard-codes a chain
        // allowlist that doesn't include Arc Testnet (5042002), spamming a
        // "configured chains are not supported" warning to the console.
        externalWallets: {
          coinbaseWallet: { config: { preference: { options: 'eoaOnly' } } },
        },
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet, sepolia, baseSepolia],
      }}
    >
      {children}
    </PrivyProvider>
  )
}
