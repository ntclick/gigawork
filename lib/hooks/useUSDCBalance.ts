'use client'

/**
 * useUSDCBalance — reads the user's Dedicated Escrow Vault & on-chain USDC balance.
 *
 * Browser-safe: reads vault balance from /api/me + on-chain balanceOf(address)
 * from the USDC contract on Arc Testnet. Seamless fallback so the UI never
 * shows a broken 0 balance or RPC timeout state.
 */
import { useEffect, useState } from 'react'
import { createPublicClient, http, type Address } from 'viem'

import { arcTestnet as arcChain } from '@/lib/chain/arcTestnet'
import { readUSDCCache, writeUSDCCache } from '@/lib/identityCache'

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC ?? 'https://arc-testnet.g.alchemy.com/v2/cxzxMQobCJKW1pAWWsPPW'
const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as Address
const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')

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
  /** Human-readable amount (string with up to 2 decimals) */
  formatted: string
  /** Raw integer balance in USDC base units (6 decimals) */
  raw: bigint
  /** Dedicated vault top-up balance from DB (user's spendable credit) */
  vaultBalance: number | null
  /** On-chain EOA balance from Arc RPC */
  onChainBalance: number
  /** True while first fetch is pending */
  loading: boolean
  /** Last error message, if any */
  error: string | null
  /** Manually re-fetch the balance */
  refetch: () => void
}

export function useUSDCBalance(address?: string | null): USDCBalanceState {
  const [vaultBal, setVaultBal] = useState<number | null>(null)
  const [raw, setRaw] = useState<bigint>(() => {
    const cached = readUSDCCache(address)
    return cached ? BigInt(cached.raw) : BigInt(0)
  })
  const [loading, setLoading] = useState(!readUSDCCache(address))
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const refetch = () => setTick((t) => t + 1)

  // 1. Fetch Dedicated Vault USDC Balance from /api/me
  useEffect(() => {
    if (!address) {
      setVaultBal(null)
      return
    }
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j.usdcBalance === 'number') {
          setVaultBal(j.usdcBalance)
        }
      })
      .catch(() => {})
  }, [address, tick])

  // 2. Fetch On-Chain EOA USDC Balance via RPC
  useEffect(() => {
    if (!address) {
      setRaw(BigInt(0))
      setLoading(false)
      return
    }
    const cached = readUSDCCache(address)
    if (cached) setRaw(BigInt(cached.raw))

    let cancelled = false
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
        writeUSDCCache(address, v as bigint)
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

  // Auto-refresh every 15s + on credit-change event
  useEffect(() => {
    if (!address) return
    const onBust = () => refetch()
    const i = setInterval(refetch, 15_000)
    window.addEventListener('gw:credits-changed', onBust)
    window.addEventListener('focus', onBust)
    return () => {
      clearInterval(i)
      window.removeEventListener('gw:credits-changed', onBust)
      window.removeEventListener('focus', onBust)
    }
  }, [address])

  // `vaultBalance` (real per-user custodial vault, lib/payments/vault.ts —
  // the spendable balance) and `onChainBalance` (the user's own external
  // EOA wallet — informational: funds available to top up FROM, not
  // itself spendable) are two genuinely different numbers and must not
  // be added together — they used to be summed into one misleading
  // `formatted` figure (and defaulted to a fake "+$10" while vault was
  // loading). `formatted` now reflects onChainBalance only, matching
  // what most consumers of it actually display (e.g. "how much USDC is
  // in your wallet to fund a top-up with"). Callers that want the real
  // vault balance should read `vaultBalance` directly (null while
  // loading — render your own loading state, don't fall back to this).
  const onChainBalance = Number(raw) / 10 ** USDC_DECIMALS
  const vaultBalance = vaultBal  // null while loading — no fake default
  const formatted = onChainBalance.toFixed(2)

  return {
    raw,
    formatted,
    vaultBalance,
    onChainBalance,
    loading: loading && vaultBal === null,
    error,
    refetch,
  }
}

