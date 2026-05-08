import { NextResponse } from 'next/server'

/**
 * GET /api/tokens/search?q=btc
 *
 * Thin proxy over CoinGecko's `/coins/search` endpoint, used by the
 * EditablePrompt token picker. Free tier (no API key) caps at ~30 req/min,
 * so we add aggressive in-memory caching keyed by lowercase query — token
 * data doesn't change minute-to-minute and the same query (e.g. "btc")
 * gets hammered.
 *
 * Response shape kept tight: only fields the picker UI actually renders.
 *   { tokens: [{ id, symbol, name, image, marketCapRank }, ...] }
 *
 * Empty q → returns top-N by market cap (the picker uses this for the
 * default state when the input is empty).
 */

interface TokenHit {
  id: string
  symbol: string
  name: string
  image: string | null
  marketCapRank: number | null
}

interface CacheEntry {
  expiresAt: number
  tokens: TokenHit[]
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, CacheEntry>()

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'

const TOP_TOKENS_FALLBACK: TokenHit[] = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: null, marketCapRank: 1 },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', image: null, marketCapRank: 2 },
  { id: 'solana', symbol: 'sol', name: 'Solana', image: null, marketCapRank: 5 },
  { id: 'binancecoin', symbol: 'bnb', name: 'BNB', image: null, marketCapRank: 4 },
  { id: 'ripple', symbol: 'xrp', name: 'XRP', image: null, marketCapRank: 6 },
  { id: 'dogecoin', symbol: 'doge', name: 'Dogecoin', image: null, marketCapRank: 7 },
  { id: 'usd-coin', symbol: 'usdc', name: 'USD Coin', image: null, marketCapRank: 8 },
  { id: 'tether', symbol: 'usdt', name: 'Tether', image: null, marketCapRank: 3 },
  { id: 'cardano', symbol: 'ada', name: 'Cardano', image: null, marketCapRank: 9 },
  { id: 'arc', symbol: 'arc', name: 'Arc Network', image: null, marketCapRank: null },
]

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const cacheKey = q || '__top__'

  const cached = cache.get(cacheKey)
  const now = Date.now()
  if (cached && cached.expiresAt > now) {
    return NextResponse.json({ tokens: cached.tokens, cached: true })
  }

  // Empty query → return curated top list. CoinGecko's `/coins/search` with
  // no q is undefined behavior, so we never hit the API in that case.
  if (!q) {
    cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, tokens: TOP_TOKENS_FALLBACK })
    return NextResponse.json({ tokens: TOP_TOKENS_FALLBACK })
  }

  try {
    const res = await fetch(`${COINGECKO_BASE}/search?query=${encodeURIComponent(q)}`, {
      headers: { accept: 'application/json' },
      // Don't let a slow CoinGecko block the picker UI for >5s — just fall
      // back to filtering the local top list client-side.
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      throw new Error(`coingecko ${res.status}`)
    }
    const json = (await res.json()) as {
      coins?: Array<{
        id: string
        symbol: string
        name: string
        thumb?: string
        large?: string
        market_cap_rank?: number | null
      }>
    }
    const tokens: TokenHit[] = (json.coins ?? []).slice(0, 25).map((c) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      image: c.large ?? c.thumb ?? null,
      marketCapRank: c.market_cap_rank ?? null,
    }))

    cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, tokens })
    return NextResponse.json({ tokens })
  } catch (err) {
    // Fall back to filtered local list so UI never shows an empty state
    // just because CoinGecko had a hiccup.
    const fallback = TOP_TOKENS_FALLBACK.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q),
    )
    return NextResponse.json({
      tokens: fallback,
      degraded: true,
      detail: err instanceof Error ? err.message : String(err),
    })
  }
}
