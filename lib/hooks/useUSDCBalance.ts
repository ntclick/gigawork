'use client'

/**
 * useUSDCBalance — reads the user's on-chain USDC balance via viem.
 *
 * Browser-safe: only uses NEXT_PUBLIC_* env. Reads `balanceOf(address)` from the
 * USDC contract every 20s + on `gw:credits-changed` event so the pill in
 * MainHeader stays fresh after a top-up or trade. Falls back to 0 cleanly when
 * RPC is unavailable so the UI never shows a broken state.
 */
import { useEffect, useState } from 'react'
import { createPublicClient, defineChain, http, type Address } from 'viem'

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC ?? 'https://rpc.drpc.testnet.arc.network'
const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '5042002')
const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as Address
const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')

const arcChain = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
})

const erc20Abi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const client = createPublicClient({ chain: arcChain, transport: http(ARC_RPC) })

export interface USDCBalanceState {
  /** Human-readable amount (string with up to 4 decimals) */
  formatted: string
  /** Raw integer balance in USDC base units (6 decimals) */
  raw: bigint
  /** True while first fetch is pending */
  loading: boolean
  /** Last error message, if any */
  error: string | null
  /** Manually re-fetch the balance */
  refetch: () => void
}

export function useUSDCBalance(address?: string | null): USDCBalanceState {
  const [raw, setRaw] = useState<bigint>(BigInt(0))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const refetch = () => setTick((t) => t + 1)

  useEffect(() => {
    if (!address) {
      setRaw(BigInt(0))
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    client
      .readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as Address],
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
  }, [address, tick])

  // Auto-refresh every 20s + on credit-change event
  useEffect(() => {
    if (!address) return
    const onBust = () => refetch()
    const i = setInterval(refetch, 20_000)
    window.addEventListener('gw:credits-changed', onBust)
    window.addEventListener('focus', onBust)
    return () => {
      clearInterval(i)
      window.removeEventListener('gw:credits-changed', onBust)
      window.removeEventListener('focus', onBust)
    }
  }, [address])

  return { raw, formatted: formatUSDC(raw), loading, error, refetch }
}

function formatUSDC(raw: bigint): string {
  if (raw === BigInt(0)) return '0'
  const divisor = BigInt(10) ** BigInt(USDC_DECIMALS)
  const whole = raw / divisor
  const frac = raw % divisor
  if (frac === BigInt(0)) return whole.toLocaleString()
  // up to 4 visible decimals, trimmed
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').slice(0, 4).replace(/0+$/, '')
  return `${whole.toLocaleString()}${fracStr ? '.' + fracStr : ''}`
}
