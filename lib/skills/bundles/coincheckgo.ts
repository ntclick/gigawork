import { getCoinBySymbol, TOP_50_COINS } from '@/lib/coins/top50Coins'

export async function runCoinCheckGoSkill(args: { symbol?: string; prompt?: string }) {
  const query = args.symbol || args.prompt || 'LINK'
  const matched = getCoinBySymbol(query) || TOP_50_COINS.find((c) => c.symbol === 'LINK') || TOP_50_COINS[0]

  try {
    const apiKey = process.env.COINGECKO_API_KEY || 'CG-odQJ8cPWrTb8wycaUuLcBpiT'
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (apiKey) {
      headers['x-cg-demo-api-key'] = apiKey
    }

    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${matched.id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
      { headers }
    )
    if (res.ok) {
      const data = await res.json()
      if (data[matched.id]) {
        const coinData = data[matched.id]
        return {
          source: 'CoinCheckGo Live API',
          symbol: matched.symbol,
          name: matched.name,
          priceUsd: coinData.usd,
          change24h: coinData.usd_24h_change,
          marketCapUsd: coinData.usd_market_cap,
          timestamp: new Date().toISOString(),
        }
      }
    }
  } catch (e) {
    console.warn('[coincheckgo-skill] Live fetch failed, using stored oracle data')
  }

  return {
    source: 'CoinCheckGo Oracle Cache',
    symbol: matched.symbol,
    name: matched.name,
    priceUsd: matched.priceUsd,
    change24h: matched.change24h,
    rank: matched.rank,
    timestamp: new Date().toISOString(),
  }
}
