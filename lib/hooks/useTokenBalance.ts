'use client'

import { useEffect, useState } from 'react'
import { createPublicClient, http, type Address } from 'viem'
import { arcTestnet } from '@/lib/chain/arcTestnet'

const erc20Abi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export interface TokenBalanceState {
  formatted: string
  raw: bigint
  loading: boolean
  error: string | null
  refetch: () => void
}

const clients: Record<string, ReturnType<typeof createPublicClient>> = {}
function getClient(rpcUrl: string) {
  if (!clients[rpcUrl]) {
    clients[rpcUrl] = createPublicClient({
      chain: arcTestnet,
      transport: http(rpcUrl),
    })
  }
  return clients[rpcUrl]
}

export function useTokenBalance(
  walletAddress?: string | null,
  tokenAddress?: string | null,
  rpcUrl?: string | null,
  decimals = 6
): TokenBalanceState {
  const [raw, setRaw] = useState<bigint>(() => {
    if (!walletAddress || !tokenAddress || typeof window === 'undefined') return BigInt(0)
    try {
      const cached = window.localStorage.getItem(`gw:token:${walletAddress.toLowerCase()}:${tokenAddress.toLowerCase()}`)
      return cached ? BigInt(cached) : BigInt(0)
    } catch {
      return BigInt(0)
    }
  })
  const [loading, setLoading] = useState(() => {
    if (!walletAddress || !tokenAddress || typeof window === 'undefined') return false
    try {
      const cached = window.localStorage.getItem(`gw:token:${walletAddress.toLowerCase()}:${tokenAddress.toLowerCase()}`)
      return !cached
    } catch {
      return true
    }
  })
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const refetch = () => setTick((t) => t + 1)

  useEffect(() => {
    if (!walletAddress || !tokenAddress || !rpcUrl) {
      setRaw(BigInt(0))
      setLoading(false)
      return
    }

    try {
      const cached = window.localStorage.getItem(`gw:token:${walletAddress.toLowerCase()}:${tokenAddress.toLowerCase()}`)
      if (cached) {
        setRaw(BigInt(cached))
        setLoading(false)
      } else {
        setRaw(BigInt(0))
        setLoading(true)
      }
    } catch {
      setRaw(BigInt(0))
      setLoading(true)
    }

    let cancelled = false
    setError(null)
    const client = getClient(rpcUrl)
    client
      .readContract({
        address: tokenAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [walletAddress as Address],
      })
      .then((v) => {
        if (cancelled) return
        setRaw(v as bigint)
        try {
          window.localStorage.setItem(`gw:token:${walletAddress.toLowerCase()}:${tokenAddress.toLowerCase()}`, v.toString())
        } catch { /* ignore */ }
      })
      .catch((e) => {
        if (cancelled) return
        console.error('[useTokenBalance] balanceOf call failed:', {
          tokenAddress,
          walletAddress,
          rpcUrl,
          error: e,
        })
        setError(e instanceof Error ? e.message : 'rpc error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [walletAddress, tokenAddress, rpcUrl, tick])

  // auto refresh
  useEffect(() => {
    if (!walletAddress || !tokenAddress || !rpcUrl) return
    const onBust = () => refetch()
    const i = setInterval(refetch, 20_000)
    window.addEventListener('gw:credits-changed', onBust)
    window.addEventListener('focus', onBust)
    return () => {
      clearInterval(i)
      window.removeEventListener('gw:credits-changed', onBust)
      window.removeEventListener('focus', onBust)
    }
  }, [walletAddress, tokenAddress, rpcUrl])

  const formatted = formatUnits(raw, decimals)
  return { raw, formatted, loading, error, refetch }
}

function formatUnits(raw: bigint, decimals: number): string {
  if (raw === BigInt(0)) return '0'
  const divisor = BigInt(10) ** BigInt(decimals)
  const whole = raw / divisor
  const frac = raw % divisor
  if (frac === BigInt(0)) return whole.toLocaleString()
  
  let fracStr = frac.toString().padStart(decimals, '0')
  fracStr = fracStr.replace(/0+$/, '')
  
  if (!fracStr) return whole.toLocaleString()
  
  // Adaptive formatting: keep up to 8 decimals for precise tokens (like cirBTC/BTC),
  // but if the value is extremely small, ensure we preserve up to 4 significant digits
  // after any leading zeros so it never displays as "0" incorrectly.
  const maxDecimals = Math.min(decimals, 8)
  if (fracStr.length > maxDecimals) {
    const firstNonZero = fracStr.search(/[1-9]/)
    if (firstNonZero !== -1) {
      const endIdx = Math.max(maxDecimals, firstNonZero + 4)
      fracStr = fracStr.slice(0, endIdx).replace(/0+$/, '')
    } else {
      fracStr = fracStr.slice(0, maxDecimals).replace(/0+$/, '')
    }
  }
  
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString()
}
