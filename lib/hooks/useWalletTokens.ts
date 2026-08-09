'use client'

/**
 * useWalletTokens — what the CONNECTED wallet holds, per swappable token.
 *
 * The vault and the connected wallet are two different wallets holding two
 * different balances, and the billing page acts on both: a deposit moves
 * USDC out of the connected wallet into the vault, while a swap trades
 * inside the connected wallet and never touches the vault. Showing only
 * the vault meant the swap panel asked the user for an amount without
 * telling them what they had to spend.
 *
 * Read-only: this signs nothing and needs no provider, just the address.
 */
import { useCallback, useEffect, useState } from 'react'
import { createPublicClient, erc20Abi, formatUnits, http } from 'viem'

import { arcTestnet } from '@/lib/chain/arcTestnet'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'

/** Same set and addresses as lib/hooks/useSwap.ts. */
const TOKENS = [
  { symbol: 'USDC', address: '0x3600000000000000000000000000000000000000' },
  { symbol: 'USYC', address: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C' },
  { symbol: 'EURC', address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' },
  { symbol: 'cirBTC', address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' },
] as const

export interface TokenBalance {
  symbol: string
  /** Whole units, already scaled by the token's own decimals. */
  amount: number
  /** Null when the contract call failed — distinct from a real zero. */
  ok: boolean
}

export interface WalletTokensState {
  address: string | null
  /** Native gas balance (Arc bills gas in USDC at 18 decimals). */
  native: number | null
  tokens: TokenBalance[]
  loading: boolean
  refresh: () => void
}

export function useWalletTokens(): WalletTokensState {
  const wallet = useActiveWallet()
  const address = wallet?.address ?? null

  const [native, setNative] = useState<number | null>(null)
  const [tokens, setTokens] = useState<TokenBalance[]>([])
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!address) {
      setNative(null)
      setTokens([])
      return
    }
    let alive = true
    setLoading(true)

    const client = createPublicClient({ chain: arcTestnet, transport: http() })
    const addr = address as `0x${string}`

    // Decimals are read per token rather than assumed. USDC and USYC are 6,
    // cirBTC is not, and a shared constant would misreport it by orders of
    // magnitude — the same trap that turned real prices into zeros in the
    // skills layer.
    const readToken = async (t: (typeof TOKENS)[number]): Promise<TokenBalance> => {
      try {
        const [raw, decimals] = await Promise.all([
          client.readContract({
            address: t.address as `0x${string}`,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [addr],
          }) as Promise<bigint>,
          client.readContract({
            address: t.address as `0x${string}`,
            abi: erc20Abi,
            functionName: 'decimals',
          }) as Promise<number>,
        ])
        return { symbol: t.symbol, amount: parseFloat(formatUnits(raw, decimals)), ok: true }
      } catch {
        // A token that cannot be read is reported as unreadable, not as
        // zero — "you have none" and "we could not check" are different
        // answers when the user is about to trade.
        return { symbol: t.symbol, amount: 0, ok: false }
      }
    }

    Promise.all([client.getBalance({ address: addr }).catch(() => null), ...TOKENS.map(readToken)])
      .then(([nativeWei, ...rows]) => {
        if (!alive) return
        setNative(nativeWei === null ? null : parseFloat(formatUnits(nativeWei as bigint, 18)))
        setTokens(rows as TokenBalance[])
      })
      .finally(() => alive && setLoading(false))

    return () => {
      alive = false
    }
  }, [address, nonce])

  return { address, native, tokens, loading, refresh }
}
