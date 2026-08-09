import { getCoinBySymbol } from '@/lib/coins/top50Coins'

export interface PlannedNode {
  id: string
  label: string
  skill_name: string
  depends_on: string[]
  input: Record<string, unknown>
}

export interface IntentPlanResult {
  intent: string
  title: string
  description: string
  plan: PlannedNode[]
  extractedParams: {
    symbol?: string
    tokenAddress?: string
    wallet?: string
    timeframe?: string
    chain?: string
    query?: string
    limit?: number
  }
}

const KNOWN_ADDRESSES: Record<string, { address: string; chain: string; symbol: string; name: string }> = {
  PEPE: { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chain: 'ethereum', symbol: 'PEPE', name: 'Pepe' },
  SHIB: { address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', chain: 'ethereum', symbol: 'SHIB', name: 'Shiba Inu' },
  UNI: { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', chain: 'ethereum', symbol: 'UNI', name: 'Uniswap' },
  LINK: { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chain: 'ethereum', symbol: 'LINK', name: 'Chainlink' },
  AAVE: { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', chain: 'ethereum', symbol: 'AAVE', name: 'Aave' },
  WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'ethereum', symbol: 'WETH', name: 'Wrapped Ether' },
  ETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  WBTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', chain: 'ethereum', symbol: 'WBTC', name: 'Wrapped Bitcoin' },
  BTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', chain: 'ethereum', symbol: 'BTC', name: 'Bitcoin' },
  USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chain: 'ethereum', symbol: 'USDT', name: 'Tether USD' },
  USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'ethereum', symbol: 'USDC', name: 'USD Coin' },
  BONK: { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', chain: 'solana', symbol: 'BONK', name: 'Bonk' },
  WIF: { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', chain: 'solana', symbol: 'WIF', name: 'dogwifhat' },
  FLOKI: { address: '0xcf0c122c6b73380ea4060a47675713d4373394c9', chain: 'ethereum', symbol: 'FLOKI', name: 'FLOKI' },
  MOG: { address: '0xaaee1a9723aadb7afa2810263653a34ba2c21c7a', chain: 'ethereum', symbol: 'MOG', name: 'Mog Coin' },
}

/**
 * Parses user natural language prompts (in Vietnamese or English) and
 * dynamically maps them to the optimal Multi-Agent team and parameters.
 */
export function analyzeUserPromptIntent(prompt: string): IntentPlanResult {
  const p = prompt.toLowerCase().trim()

  // 1. Extract potential Ethereum / Solana contract or wallet address
  const ethAddressMatch = prompt.match(/0x[a-fA-F0-9]{40}/)
  const ethAddress = ethAddressMatch ? ethAddressMatch[0] : undefined

  // 2. Extract token symbol (e.g. $PEPE, PEPE, BTC, ETH, SOL, SHIB)
  let symbol: string | undefined
  const cashtagMatch = prompt.match(/\$([a-zA-Z0-9]{2,10})/)
  if (cashtagMatch) {
    symbol = cashtagMatch[1].toUpperCase()
  } else {
    // Check known symbols
    for (const sym of Object.keys(KNOWN_ADDRESSES)) {
      const reg = new RegExp(`\\b${sym}\\b`, 'i')
      if (reg.test(prompt)) {
        symbol = sym
        break
      }
    }
    if (!symbol) {
      const foundCoin = getCoinBySymbol(prompt)
      if (foundCoin) symbol = foundCoin.symbol.toUpperCase()
    }
  }

  // 3. Resolve contract address if available
  let tokenAddress = ethAddress
  let chain = 'ethereum'
  if (symbol && KNOWN_ADDRESSES[symbol]) {
    if (!tokenAddress) tokenAddress = KNOWN_ADDRESSES[symbol].address
    chain = KNOWN_ADDRESSES[symbol].chain
  }
  if (!tokenAddress && symbol === 'PEPE') {
    tokenAddress = '0x6982508145454ce325ddbe47a25d4ec3d2311933'
  }

  // 4. Extract timeframe (1h, 4h, 1d, 1w)
  let timeframe = '4h'
  const tfMatch = prompt.match(/\b(1m|5m|15m|1h|4h|1d|1w)\b/i)
  if (tfMatch) timeframe = tfMatch[1].toLowerCase()

  // ─────────────────────────────────────────────────────────────────────────
  // Intent Classification Rules (supports Vietnamese & English keywords)
  // ─────────────────────────────────────────────────────────────────────────

  // Intent A: Whale Tracking / Smart Money Flow
  const isWhaleIntent =
    p.includes('whale') ||
    p.includes('cá voi') ||
    p.includes('smart money') ||
    p.includes('ví lớn') ||
    p.includes('gom hàng') ||
    p.includes('xả hàng') ||
    p.includes('flow') ||
    (ethAddress && (p.includes('track') || p.includes('quét ví') || p.includes('theo dõi ví')))

  if (isWhaleIntent) {
    const targetWallet = ethAddress || '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
    return {
      intent: 'whale_tracker',
      title: 'Whale Tracker & Smart Money Flow Team',
      description: 'Tracks high-value transactions, smart money wallet transfers, and price correlation momentum.',
      extractedParams: { wallet: targetWallet, symbol: symbol || 'ETH' },
      plan: [
        {
          id: 'whale',
          label: 'Track High-Value Wallet Transactions',
          skill_name: 'whale-tracker',
          depends_on: [],
          input: { wallet: targetWallet, network: 'eth-mainnet', limit: 25 },
        },
        {
          id: 'signals',
          label: `Correlate ${symbol || 'ETH'} Price Momentum`,
          skill_name: 'trading-signals',
          depends_on: [],
          input: { symbol: `${symbol || 'ETH'}/USDT`, timeframe },
        },
        {
          id: 'composer',
          label: 'Compose Whale Accumulation & Flow Report',
          skill_name: 'report-composer',
          depends_on: ['whale', 'signals'],
          input: {},
        },
      ],
    }
  }

  // Intent B: DeFi Yields & APY Optimization
  const isYieldIntent =
    p.includes('yield') ||
    p.includes('lãi suất') ||
    p.includes('lãi') ||
    p.includes('apy') ||
    p.includes('pool') ||
    p.includes('defi') ||
    p.includes('đào coin') ||
    p.includes('nông dân') ||
    p.includes('stablecoin') ||
    p.includes('tvl')

  if (isYieldIntent) {
    return {
      intent: 'defi_yields',
      title: 'DeFi Yield APY Hunter & Optimizer Team',
      description: 'Scans top DeFi liquidity pools across chains for highest sustainable APY and stablecoin yield.',
      extractedParams: { chain, limit: 5 },
      plan: [
        {
          id: 'yields',
          label: 'Scan Top DeFi APY Pools',
          skill_name: 'defi-yields',
          depends_on: [],
          input: { top_n: 5, min_tvl_usd: 1_000_000, stablecoin_only: true },
        },
        {
          id: 'signals',
          label: 'Analyze ETH & BTC Market Momentum',
          skill_name: 'trading-signals',
          depends_on: [],
          input: { symbol: 'ETH/USDT', timeframe },
        },
        {
          id: 'composer',
          label: 'Compose Yield Optimization & Risk Report',
          skill_name: 'report-composer',
          depends_on: ['yields', 'signals'],
          input: {},
        },
      ],
    }
  }

  // Intent C: Technical Indicators / Trading Signals (RSI/MACD)
  const isTechnicalSignalsIntent =
    p.includes('rsi') ||
    p.includes('macd') ||
    p.includes('tín hiệu') ||
    p.includes('chỉ báo') ||
    p.includes('kỹ thuật') ||
    p.includes('momentum') ||
    p.includes('signal') ||
    p.includes('indicator') ||
    p.includes('overbought') ||
    p.includes('oversold')

  if (isTechnicalSignalsIntent) {
    const targetSymbol = symbol || 'BTC'
    return {
      intent: 'trading_signals',
      title: `Technical Signals Analyst Team (${targetSymbol})`,
      description: `Calculates multi-timeframe RSI, MACD, and momentum indicators for ${targetSymbol} orderbooks.`,
      extractedParams: { symbol: targetSymbol, timeframe },
      plan: [
        {
          id: 'primary_signals',
          label: `Calculate ${targetSymbol}/USDT RSI & MACD`,
          skill_name: 'trading-signals',
          depends_on: [],
          input: { symbol: `${targetSymbol}/USDT`, timeframe, exchange: 'binance' },
        },
        {
          id: 'scanner',
          label: `Verify ${targetSymbol} On-Chain Liquidity Depth`,
          skill_name: 'crypto-scanner',
          depends_on: [],
          input: { token_address: tokenAddress || targetSymbol, chain },
        },
        {
          id: 'composer',
          label: 'Compile Actionable Market Signals Brief',
          skill_name: 'report-composer',
          depends_on: ['primary_signals', 'scanner'],
          input: {},
        },
      ],
    }
  }

  // Intent D: Market Sentiment & Prediction Odds (Polymarket / Social)
  const isSentimentIntent =
    p.includes('sentiment') ||
    p.includes('tâm lý') ||
    p.includes('đám đông') ||
    p.includes('mạng xã hội') ||
    p.includes('twitter') ||
    p.includes('reddit') ||
    p.includes('polymarket') ||
    p.includes('dự đoán') ||
    p.includes('prediction') ||
    p.includes('xác suất')

  if (isSentimentIntent) {
    return {
      intent: 'market_sentiment',
      title: 'Market Sentiment & Prediction Intelligence Team',
      description: 'Aggregates Polymarket prediction odds and social media sentiment across crypto communities.',
      extractedParams: { query: prompt },
      plan: [
        {
          id: 'polymarket',
          label: 'Scan Prediction Market Probabilities',
          skill_name: 'polymarket-pulse',
          depends_on: [],
          input: { tag: 'crypto', limit: 6 },
        },
        {
          id: 'sentiment',
          label: 'Analyze Social Media Sentiment',
          skill_name: 'social-sentiment',
          depends_on: [],
          input: { query: symbol ? `${symbol} crypto market` : 'bitcoin ethereum crypto market' },
        },
        {
          id: 'composer',
          label: 'Compose Market Sentiment & Prediction Brief',
          skill_name: 'report-composer',
          depends_on: ['polymarket', 'sentiment'],
          input: {},
        },
      ],
    }
  }

  // Intent E: NFT Collection Watch
  const isNftIntent =
    p.includes('nft') ||
    p.includes('opensea') ||
    p.includes('floor') ||
    p.includes('pudgy') ||
    p.includes('bayc') ||
    p.includes('punk') ||
    p.includes('azuki')

  if (isNftIntent) {
    const collectionSlug = p.includes('bayc') ? 'boredapeyachtclub'
      : p.includes('punk') ? 'cryptopunks'
      : p.includes('azuki') ? 'azuki'
      : 'pudgypenguins'

    return {
      intent: 'nft_watch',
      title: 'NFT Floor & Liquidity Sentinel Team',
      description: 'Monitors OpenSea collection floor prices, listing velocity, and 24h trading volume.',
      extractedParams: { query: collectionSlug },
      plan: [
        {
          id: 'nft_floor',
          label: `Retrieve OpenSea Floor Stats (${collectionSlug})`,
          skill_name: 'nft-floor-watch',
          depends_on: [],
          input: { collection_slug: collectionSlug },
        },
        {
          id: 'signals',
          label: 'Correlate ETH Liquidity Pulse',
          skill_name: 'trading-signals',
          depends_on: [],
          input: { symbol: 'ETH/USDT', timeframe: '4h' },
        },
        {
          id: 'composer',
          label: 'Compose NFT Valuation & Floor Brief',
          skill_name: 'report-composer',
          depends_on: ['nft_floor', 'signals'],
          input: {},
        },
      ],
    }
  }

  // Intent F: Web Research & Document Digest
  const isResearchIntent =
    p.includes('nghiên cứu') ||
    p.includes('research') ||
    p.includes('tìm hiểu') ||
    p.includes('tin tức') ||
    p.includes('news') ||
    p.includes('tài liệu') ||
    p.includes('document') ||
    p.includes('whitepaper') ||
    p.includes('xu hướng') ||
    p.includes('trend')

  if (isResearchIntent) {
    const cleanQuery = prompt.replace(/nghiên cứu|research|tìm hiểu|cho tôi biết/gi, '').trim() || 'Latest trends in AI agent workflows and DeFi'
    return {
      intent: 'web_research',
      title: 'Web Intelligence & Narrative Research Team',
      description: 'Gathers live web news, whitepapers, and narrative intelligence aggregated into a strategic brief.',
      extractedParams: { query: cleanQuery },
      plan: [
        {
          id: 'intel',
          label: 'Gather Web Intelligence & News',
          skill_name: 'web-intel',
          depends_on: [],
          input: { query: cleanQuery, max_results: 5 },
        },
        {
          id: 'signals',
          label: 'Analyze Crypto Market Pulse',
          skill_name: 'trading-signals',
          depends_on: [],
          input: { symbol: 'BTC/USDT', timeframe: '4h' },
        },
        {
          id: 'composer',
          label: 'Compose Strategic Intelligence Report',
          skill_name: 'report-composer',
          depends_on: ['intel', 'signals'],
          input: {},
        },
      ],
    }
  }

  // Default / Token Scanner Intent (PEPE, ETH, BTC, any token lookup)
  const targetSymbol = symbol || 'PEPE'
  const targetAddress = tokenAddress || '0x6982508145454ce325ddbe47a25d4ec3d2311933'

  return {
    intent: 'token_scanner',
    title: `Token Valuation & Security Audit Team (${targetSymbol})`,
    description: `Audits on-chain liquidity depth, sub-cent pricing, and RSI/MACD technical momentum for ${targetSymbol}.`,
    extractedParams: { symbol: targetSymbol, tokenAddress: targetAddress, chain },
    plan: [
      {
        id: 'scanner',
        label: `Scan ${targetSymbol} On-Chain Metrics & Liquidity`,
        skill_name: 'crypto-scanner',
        depends_on: [],
        input: { token_address: targetAddress, symbol: targetSymbol, chain },
      },
      {
        id: 'signals',
        label: `Calculate ${targetSymbol}/USDT Technical Momentum`,
        skill_name: 'trading-signals',
        depends_on: [],
        input: { symbol: `${targetSymbol}/USDT`, timeframe: '4h', exchange: 'binance' },
      },
      {
        id: 'composer',
        label: `Compile ${targetSymbol} Valuation & Security Report`,
        skill_name: 'report-composer',
        depends_on: ['scanner', 'signals'],
        input: {},
      },
    ],
  }
}
