'use client'

/**
 * TokenPicker — autocomplete input for token contracts.
 *
 * - Type a symbol/name → suggestion list shows top matches with chain badge
 * - Click a suggestion → fills the address field
 * - Paste a 0x contract directly → kept as-is (custom token path)
 *
 * The list is hard-coded so the picker works offline. ~25 of the most
 * commonly-asked tokens across the chains GigaWork supports. Users can
 * always type any contract; the picker is convenience, not a gate.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Hash } from 'lucide-react'

export type Chain = 'ethereum' | 'base' | 'solana' | 'arbitrum' | 'optimism' | 'polygon' | 'bsc'

export interface TokenEntry {
  symbol: string
  name: string
  chain: Chain
  address: string
}

const TOKENS: TokenEntry[] = [
  // Majors
  { symbol: 'WETH', name: 'Wrapped Ether', chain: 'ethereum', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  { symbol: 'WBTC', name: 'Wrapped BTC', chain: 'ethereum', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
  { symbol: 'cirBTC', name: 'cirBTC', chain: 'ethereum', address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' },
  { symbol: 'USDT', name: 'Tether USD', chain: 'ethereum', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  { symbol: 'USDC', name: 'USD Coin', chain: 'ethereum', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  { symbol: 'DAI', name: 'Dai Stablecoin', chain: 'ethereum', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
  // Memes
  { symbol: 'PEPE', name: 'Pepe', chain: 'ethereum', address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933' },
  { symbol: 'SHIB', name: 'Shiba Inu', chain: 'ethereum', address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE' },
  { symbol: 'FLOKI', name: 'Floki', chain: 'ethereum', address: '0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E' },
  // DeFi
  { symbol: 'UNI', name: 'Uniswap', chain: 'ethereum', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984' },
  { symbol: 'LINK', name: 'Chainlink', chain: 'ethereum', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA' },
  { symbol: 'AAVE', name: 'Aave', chain: 'ethereum', address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9' },
  { symbol: 'CRV', name: 'Curve DAO', chain: 'ethereum', address: '0xD533a949740bb3306d119CC777fa900bA034cd52' },
  { symbol: 'LDO', name: 'Lido DAO', chain: 'ethereum', address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32' },
  // L2 / sidechains tokens (on Ethereum L1)
  { symbol: 'ARB', name: 'Arbitrum', chain: 'arbitrum', address: '0x912CE59144191C1204E64559FE8253a0e49E6548' },
  { symbol: 'OP', name: 'Optimism', chain: 'optimism', address: '0x4200000000000000000000000000000000000042' },
  { symbol: 'MATIC', name: 'Polygon', chain: 'polygon', address: '0x0000000000000000000000000000000000001010' },
  // Base
  { symbol: 'cbETH', name: 'Coinbase Wrapped ETH', chain: 'base', address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' },
  { symbol: 'AERO', name: 'Aerodrome', chain: 'base', address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631' },
  // BSC
  { symbol: 'CAKE', name: 'PancakeSwap', chain: 'bsc', address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82' },
  // Solana (SPL mints)
  { symbol: 'SOL', name: 'Solana (native)', chain: 'solana', address: 'So11111111111111111111111111111111111111112' },
  { symbol: 'BONK', name: 'Bonk', chain: 'solana', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  { symbol: 'JUP', name: 'Jupiter', chain: 'solana', address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
  { symbol: 'WIF', name: 'dogwifhat', chain: 'solana', address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
]

const CHAIN_COLORS: Record<Chain, string> = {
  ethereum: 'bg-blue-500/15 text-blue-200 border-blue-400/30',
  base: 'bg-cyan-500/15 text-cyan-200 border-cyan-400/30',
  solana: 'bg-purple-500/15 text-purple-200 border-purple-400/30',
  arbitrum: 'bg-sky-500/15 text-sky-200 border-sky-400/30',
  optimism: 'bg-red-500/15 text-red-200 border-red-400/30',
  polygon: 'bg-violet-500/15 text-violet-200 border-violet-400/30',
  bsc: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
}

interface Props {
  value: string
  onChange: (address: string, picked?: TokenEntry) => void
  /** Optional: only show tokens for this chain. Empty = all chains. */
  chain?: string
  placeholder?: string
}

const isContractLike = (s: string) =>
  /^0x[a-fA-F0-9]{6,}/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(s)

export function TokenPicker({ value, onChange, chain, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Sync external value changes (e.g., template default) into the local input.
  useEffect(() => {
    setQuery(value)
  }, [value])

  // Click-outside closes the dropdown.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let pool = TOKENS
    if (chain) {
      const c = chain.toLowerCase() as Chain
      pool = pool.filter((t) => t.chain === c)
      if (pool.length === 0) pool = TOKENS // chain has no entries → fall back to all
    }
    if (!q || isContractLike(query)) return pool.slice(0, 8)
    return pool
      .filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.address.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [query, chain])

  const matchedExisting = useMemo(
    () => TOKENS.find((t) => t.address.toLowerCase() === value.toLowerCase()),
    [value],
  )

  const looksLikeContract = isContractLike(query)

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center border-2 border-black bg-[#1f1f33] focus-within:border-[var(--giga-accent)]">
        <input
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            // If the user types a contract directly, propagate immediately so
            // the form has the value even if they don't click a suggestion.
            if (isContractLike(e.target.value)) onChange(e.target.value)
          }}
          placeholder={placeholder ?? 'Search token (PEPE, USDC…) or paste 0x contract'}
          className="flex-1 bg-transparent px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        {matchedExisting && !open && (
          <span
            className={`mr-2 inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${CHAIN_COLORS[matchedExisting.chain]}`}
          >
            {matchedExisting.symbol}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="px-2 text-white/45 hover:text-white"
          aria-label="Toggle token list"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto border-2 border-black bg-[#15152a] shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
          {filtered.length === 0 && !looksLikeContract && (
            <div className="px-3 py-3 text-xs text-white/45">
              No tokens match. Type a contract address (0x… or Solana mint) to use a custom token.
            </div>
          )}
          {filtered.map((t) => (
            <button
              type="button"
              key={`${t.chain}:${t.address}`}
              onClick={() => {
                setQuery(t.address)
                onChange(t.address, t)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 border-b border-white/5 px-3 py-2 text-left transition hover:bg-white/[0.04] ${
                value.toLowerCase() === t.address.toLowerCase() ? 'bg-[var(--giga-accent)]/10' : ''
              }`}
            >
              <span className="font-pixel-body w-14 shrink-0 text-sm font-bold text-white">
                {t.symbol}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-white/65">{t.name}</span>
              <span
                className={`shrink-0 border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${CHAIN_COLORS[t.chain]}`}
              >
                {t.chain}
              </span>
              <span className="hidden shrink-0 font-mono text-[10px] text-white/35 md:inline">
                {t.address.slice(0, 6)}…{t.address.slice(-4)}
              </span>
            </button>
          ))}
          {looksLikeContract && (
            <button
              type="button"
              onClick={() => {
                onChange(query)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 border-t-2 border-[var(--giga-accent)]/40 bg-[var(--giga-accent)]/[0.06] px-3 py-2 text-left text-[var(--giga-accent)] hover:bg-[var(--giga-accent)]/10"
            >
              <Hash className="h-3 w-3" />
              <span className="font-mono text-xs">Use custom: {query.slice(0, 14)}…{query.slice(-6)}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** True for fields the form should render with TokenPicker instead of plain text. */
export function isTokenAddressField(name: string): boolean {
  const n = name.toLowerCase()
  return n === 'token_address' || n === 'contract_address' || n === 'token' || n === 'mint'
}
