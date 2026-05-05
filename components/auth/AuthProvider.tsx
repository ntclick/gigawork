'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { defineChain } from 'viem'

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID
const CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID
// Default to the public dRPC endpoint (no key needed). The Alchemy demo
// URL we previously fell back to was 400-rejecting requests.
const RPC = process.env.NEXT_PUBLIC_ARC_RPC ?? 'https://rpc.drpc.testnet.arc.network'
const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: 'ArcScan', url: EXPLORER } },
  testnet: true,
})

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
