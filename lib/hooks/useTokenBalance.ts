'use client'

import { useEffect, useState } from 'react'
import { createPublicClient, http, type Address } from 'viem'

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
    clients[rpcUrl] = createPublicClient({ transport: http(rpcUrl) })
  }
  return clients[rpcUrl]
}

export function useTokenBalance(
  walletAddress?: string | null,
  tokenAddress?: string | null,
  rpcUrl?: string | null,
  decimals = 6
): TokenBalanceState {
  const [raw, setRaw] = useState<bigint>(BigInt(0))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const refetch = () => setTick((t) => t + 1)

  useEffect(() => {
    if (!walletAddress || !tokenAddress || !rpcUrl) {
      setRaw(BigInt(0))
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
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
      })
      .catch((e) => {
        if (cancelled) return
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
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '')
  return `${whole.toLocaleString()}${fracStr ? '.' + fracStr : ''}`
}
