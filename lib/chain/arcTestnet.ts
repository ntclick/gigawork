/**
 * Arc Testnet chain definition — shared between server and client.
 *
 * IMPORTANT: Do NOT use `arcTestnet` from `viem/chains`. The bundled one
 * has `nativeCurrency: { symbol: 'ETH' }` — wrong symbol for Arc. Arc
 * uses USDC as the native gas token symbol but the underlying wei scale
 * is still **18 decimals** (verified via eth_getBalance returning
 * 18-decimal wei values). Note this is DIFFERENT from the USDC ERC20
 * contract at 0x3600…0000 which uses 6 decimals; the native and the
 * ERC20 are linked 1:1 in value but stored at different scales.
 *
 * With the wrong symbol (ETH), external wallets like OKX show fees in
 * ETH units → confusing UX and (when chain mismatch) underpriced tx.
 * With wrong decimals (6 instead of 18), UI fee display becomes
 * nonsense even though on-chain math is unaffected. See AGENTS.md §1.
 *
 * Server admin code lives in lib/chain/client.ts which throws at import
 * time if ARC_RPC_URL is missing — so we keep this lightweight chain
 * definition in its own module that's safe to import from client
 * components too.
 */
import { defineChain } from 'viem'

export const ARC_CHAIN_ID = 5042002

const PRIMARY_RPC =
  process.env.NEXT_PUBLIC_ARC_RPC ||
  process.env.ARC_RPC_URL ||
  'https://rpc.testnet.arc.network'

export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [PRIMARY_RPC] },
    public: { http: ['https://rpc.drpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app',
    },
  },
  testnet: true,
})
