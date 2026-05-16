'use client'

import { PrivyProvider } from '@privy-io/react-auth'

// Use the shared arcTestnet — has USDC as nativeCurrency, which is what
// external wallets (OKX, MetaMask) need to estimate gas correctly.
// Privy passes this chain config to the wallet popup, so it MUST match.
// See lib/chain/arcTestnet.ts + AGENTS.md §1.
import { arcTestnet } from '@/lib/chain/arcTestnet'

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID
const CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID

export function AuthProvider({ children }: { children: React.ReactNode }) {
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
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
        },
        // Force Coinbase Wallet to EOA mode. Smart Wallet hard-codes a chain
        // allowlist that doesn't include Arc Testnet (5042002), spamming a
        // "configured chains are not supported" warning to the console.
        externalWallets: {
          coinbaseWallet: { config: { preference: { options: 'eoaOnly' } } },
        },
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet],
      }}
    >
      {children}
    </PrivyProvider>
  )
}
