export interface CoinInfo {
  id: string
  symbol: string
  name: string
  priceUsd: number
  change24h: number
  rank: number
  icon?: string
}

export const TOP_50_COINS: CoinInfo[] = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', priceUsd: 96500, change24h: 2.4, rank: 1 },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', priceUsd: 3350, change24h: 1.8, rank: 2 },
  { id: 'tether', symbol: 'USDT', name: 'Tether', priceUsd: 1.0, change24h: 0.01, rank: 3 },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB', priceUsd: 680, change24h: -0.5, rank: 4 },
  { id: 'solana', symbol: 'SOL', name: 'Solana', priceUsd: 195, change24h: 5.2, rank: 5 },
  { id: 'ripple', symbol: 'XRP', name: 'XRP', priceUsd: 2.45, change24h: 8.1, rank: 6 },
  { id: 'usd-coin', symbol: 'USDC', name: 'USDC', priceUsd: 1.0, change24h: 0.0, rank: 7 },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano', priceUsd: 0.95, change24h: 3.4, rank: 8 },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', priceUsd: 38.5, change24h: 4.1, rank: 9 },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', priceUsd: 0.32, change24h: -1.2, rank: 10 },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', priceUsd: 18.75, change24h: 6.8, rank: 11 },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot', priceUsd: 8.2, change24h: 2.3, rank: 12 },
  { id: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu', priceUsd: 0.000024, change24h: 1.1, rank: 13 },
  { id: 'sui', symbol: 'SUI', name: 'Sui', priceUsd: 3.45, change24h: 12.4, rank: 14 },
  { id: 'near', symbol: 'NEAR', name: 'NEAR Protocol', priceUsd: 6.8, change24h: 4.5, rank: 15 },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin', priceUsd: 115, change24h: 0.9, rank: 16 },
  { id: 'uniswap', symbol: 'UNI', name: 'Uniswap', priceUsd: 12.4, change24h: 3.8, rank: 17 },
  { id: 'pepe', symbol: 'PEPE', name: 'Pepe', priceUsd: 0.000019, change24h: 15.2, rank: 18 },
  { id: 'aptos', symbol: 'APT', name: 'Aptos', priceUsd: 14.2, change24h: 2.7, rank: 19 },
  { id: 'bittensor', symbol: 'TAO', name: 'Bittensor', priceUsd: 540, change24h: 7.6, rank: 20 },
  { id: 'render-token', symbol: 'RENDER', name: 'Render', priceUsd: 9.8, change24h: 5.4, rank: 21 },
  { id: 'fetch-ai', symbol: 'FET', name: 'Artificial Superintelligence Alliance', priceUsd: 1.85, change24h: 6.1, rank: 22 },
  { id: 'injective-protocol', symbol: 'INJ', name: 'Injective', priceUsd: 28.5, change24h: 3.9, rank: 23 },
  { id: 'celestia', symbol: 'TIA', name: 'Celestia', priceUsd: 7.4, change24h: -2.1, rank: 24 },
  { id: 'optimism', symbol: 'OP', name: 'Optimism', priceUsd: 2.15, change24h: 1.8, rank: 25 },
  { id: 'arbitrum', symbol: 'ARB', name: 'Arbitrum', priceUsd: 1.12, change24h: 2.0, rank: 26 },
  { id: 'kaspa', symbol: 'KAS', name: 'Kaspa', priceUsd: 0.165, change24h: 3.2, rank: 27 },
  { id: 'cosmos', symbol: 'ATOM', name: 'Cosmos', priceUsd: 8.9, change24h: 1.4, rank: 28 },
  { id: 'stellar', symbol: 'XLM', name: 'Stellar', priceUsd: 0.52, change24h: 4.8, rank: 29 },
  { id: 'hedera-hashgraph', symbol: 'HBAR', name: 'Hedera', priceUsd: 0.28, change24h: 9.3, rank: 30 },
  { id: 'vechain', symbol: 'VET', name: 'VeChain', priceUsd: 0.045, change24h: 2.6, rank: 31 },
  { id: 'monero', symbol: 'XMR', name: 'Monero', priceUsd: 162, change24h: -0.4, rank: 32 },
  { id: 'okb', symbol: 'OKB', name: 'OKB', priceUsd: 48.5, change24h: 0.6, rank: 33 },
  { id: 'filecoin', symbol: 'FIL', name: 'Filecoin', priceUsd: 6.2, change24h: 1.5, rank: 34 },
  { id: 'immutable-x', symbol: 'IMX', name: 'Immutable', priceUsd: 1.95, change24h: 3.1, rank: 35 },
  { id: 'the-graph', symbol: 'GRT', name: 'The Graph', priceUsd: 0.26, change24h: 4.0, rank: 36 },
  { id: 'fantom', symbol: 'FTM', name: 'Sonic (Fantom)', priceUsd: 0.92, change24h: 5.7, rank: 37 },
  { id: 'algorand', symbol: 'ALGO', name: 'Algorand', priceUsd: 0.34, change24h: 3.8, rank: 38 },
  { id: 'aave', symbol: 'AAVE', name: 'Aave', priceUsd: 210, change24h: 6.2, rank: 39 },
  { id: 'maker', symbol: 'MKR', name: 'Maker', priceUsd: 1850, change24h: 2.1, rank: 40 },
  { id: 'stacks', symbol: 'STX', name: 'Stacks', priceUsd: 2.4, change24h: 4.9, rank: 41 },
  { id: 'flow', symbol: 'FLOW', name: 'Flow', priceUsd: 0.88, change24h: 1.2, rank: 42 },
  { id: 'pyth-network', symbol: 'PYTH', name: 'Pyth Network', priceUsd: 0.48, change24h: 7.2, rank: 43 },
  { id: 'sei-network', symbol: 'SEI', name: 'Sei', priceUsd: 0.58, change24h: 8.4, rank: 44 },
  { id: 'worldcoin-wld', symbol: 'WLD', name: 'Worldcoin', priceUsd: 2.85, change24h: -1.5, rank: 45 },
  { id: 'floki', symbol: 'FLOKI', name: 'FLOKI', priceUsd: 0.00021, change24h: 11.3, rank: 46 },
  { id: 'bonk', symbol: 'BONK', name: 'Bonk', priceUsd: 0.000038, change24h: 9.8, rank: 47 },
  { id: 'lido-dao', symbol: 'LDO', name: 'Lido DAO', priceUsd: 1.92, change24h: 2.5, rank: 48 },
  { id: 'the-open-network', symbol: 'TON', name: 'Toncoin', priceUsd: 5.65, change24h: 3.1, rank: 49 },
  { id: 'mantle', symbol: 'MNT', name: 'Mantle', priceUsd: 0.82, change24h: 1.9, rank: 50 },
]

export function searchTop50Coins(query: string): CoinInfo[] {
  if (!query) return TOP_50_COINS.slice(0, 10)
  const clean = query.replace(/^\$/, '').toUpperCase().trim()
  if (!clean) return TOP_50_COINS.slice(0, 10)

  return TOP_50_COINS.filter(
    (c) => c.symbol.toUpperCase().includes(clean) || c.name.toUpperCase().includes(clean)
  ).slice(0, 10)
}

export function getCoinBySymbol(symbolOrPrompt: string): CoinInfo | undefined {
  if (!symbolOrPrompt) return undefined
  const upper = symbolOrPrompt.toUpperCase().trim()

  // 1. Exact symbol match (e.g., "$LINK" or "LINK")
  const clean = upper.replace(/^\$/, '').trim()
  const exact = TOP_50_COINS.find((c) => c.symbol.toUpperCase() === clean)
  if (exact) return exact

  // 2. Search for any $SYMBOL in the prompt text (e.g., "Track $ETH signals")
  const dollarMatch = upper.match(/\$([A-Z0-9]+)/)
  if (dollarMatch) {
    const sym = dollarMatch[1]
    const matched = TOP_50_COINS.find((c) => c.symbol.toUpperCase() === sym)
    if (matched) return matched
  }

  // 3. Search for word matches in prompt text (e.g., "BTC", "ETH", "BITCOIN", "SOLANA")
  const found = TOP_50_COINS.find(
    (c) =>
      new RegExp(`\\b${c.symbol.toUpperCase()}\\b`).test(upper) ||
      new RegExp(`\\b${c.name.toUpperCase()}\\b`).test(upper)
  )
  return found
}
