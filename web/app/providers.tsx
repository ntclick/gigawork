'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { arcTestnet } from '@/lib/chain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient()

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <PrivyProvider
        appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
        config={{
          defaultChain: arcTestnet,
          supportedChains: [arcTestnet],
          loginMethods: ['email', 'wallet'],
          embeddedWallets: {
            ethereum: {
              createOnLogin: 'users-without-wallets',
            },
          },
          appearance: {
            theme: 'dark',
            accentColor: '#00e5ff',
            showWalletLoginFirst: false,
            walletList: ['metamask', 'detected_ethereum_wallets', 'okx_wallet', 'phantom'],
          },
          fundingMethodConfig: {
            moonpay: { useSandbox: true },
          },
        }}
      >
        {children}
      </PrivyProvider>
    </QueryClientProvider>
  )
}
