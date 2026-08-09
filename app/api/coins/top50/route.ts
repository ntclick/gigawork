import { NextResponse } from 'next/server'
import { TOP_50_COINS, type CoinInfo } from '@/lib/coins/top50Coins'

export const dynamic = 'force-dynamic'

let cachedCoins: CoinInfo[] | null = null
let lastFetchTs = 0
const CACHE_TTL_MS = 60 * 1000 // 1 minute cache

export async function GET() {
  const now = Date.now()
  if (cachedCoins && now - lastFetchTs < CACHE_TTL_MS) {
    return NextResponse.json({ coins: cachedCoins, source: 'cache' })
  }

  try {
    const apiKey = process.env.COINGECKO_API_KEY || 'CG-odQJ8cPWrTb8wycaUuLcBpiT'
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (apiKey) {
      headers['x-cg-demo-api-key'] = apiKey
    }

    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false',
      {
        headers,
        next: { revalidate: 60 },
      }
    )

    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        cachedCoins = data.map((item: any, idx: number) => ({
          id: item.id,
          symbol: item.symbol?.toUpperCase() ?? 'COIN',
          name: item.name ?? item.symbol,
          priceUsd: item.current_price ?? 0,
          change24h: item.price_change_percentage_24h ?? 0,
          rank: item.market_cap_rank ?? idx + 1,
          icon: item.image,
        }))
        lastFetchTs = now
        return NextResponse.json({ coins: cachedCoins, source: 'coingecko_live' })
      }
    }
  } catch (e) {
    console.warn('[coincheckgo-api] Failed to fetch live CoinGecko data, fallback to TOP_50_COINS', e)
  }

  return NextResponse.json({ coins: TOP_50_COINS, source: 'top50_fallback' })
}
