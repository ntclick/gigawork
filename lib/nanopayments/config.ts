/**
 * Agent Endpoint Registry
 *
 * Defines all x402-monetized Agent API endpoints.
 * Each entry maps a skill name to its pricing, description, and status.
 *
 * To add a new Agent:
 *   1. Add an entry to AGENT_ENDPOINTS below
 *   2. Create a handler in lib/skills/handlers.ts
 *   3. The x402 middleware in /api/agents/[skill]/route.ts will auto-pick it up
 */

export interface AgentEndpoint {
  /** Unique skill identifier — must match lib/skills/handlers.ts SKILLS key */
  skill: string
  /** Display name for the Dashboard */
  name: string
  /** Short description */
  description: string
  /** Price per API call in USDC (e.g. "0.01") */
  priceUsdc: string
  /** Category for grouping in the Dashboard */
  category: 'research' | 'on-chain' | 'execution' | 'notification'
  /** Emoji icon */
  emoji: string
  /** Whether nanopayment gating is active */
  enabled: boolean
  /** Expected latency hint (ms) */
  latencyMs?: number
  /** Supported input params (informational) */
  inputParams?: string[]
  /** On-chain agent token ID if applicable */
  agentTokenId?: string | null
  /** Reputation score (0-100) */
  reputationScore?: number
}

export const AGENT_ENDPOINTS: AgentEndpoint[] = [
  {
    skill: 'crypto-scanner',
    name: 'Birdeye Token Scanner',
    description: 'On-chain metrics scan: price, volume, holders, liquidity depth for any EVM token.',
    priceUsdc: '0.005',
    category: 'research',
    emoji: '🔍',
    enabled: true,
    latencyMs: 3000,
    inputParams: ['token_address', 'chain'],
  },
  {
    skill: 'whale-tracker',
    name: 'Whale Flow Analyst',
    description: 'Tracks large wallet transactions to detect accumulation or distribution patterns.',
    priceUsdc: '0.008',
    category: 'on-chain',
    emoji: '🐳',
    enabled: true,
    latencyMs: 4000,
    inputParams: ['wallet', 'network', 'limit'],
  },
  {
    skill: 'defi-yields',
    name: 'DeFi Yield Hunter',
    description: 'Scans DeFi protocols for highest APY pools filtered by TVL and stablecoin status.',
    priceUsdc: '0.005',
    category: 'research',
    emoji: '🌾',
    enabled: true,
    latencyMs: 5000,
    inputParams: ['top_n', 'min_tvl_usd', 'stablecoin_only'],
  },
  {
    skill: 'trading-signals',
    name: 'Technical Signals Engine',
    description: 'Calculates RSI, MACD, Bollinger Bands for any trading pair across major exchanges.',
    priceUsdc: '0.005',
    category: 'execution',
    emoji: '📈',
    enabled: true,
    latencyMs: 2500,
    inputParams: ['symbol', 'timeframe', 'exchange'],
  },
  {
    skill: 'report-composer',
    name: 'AI Report Composer',
    description: 'LLM-powered synthesis agent that composes structured Markdown reports from raw data.',
    priceUsdc: '0.01',
    category: 'research',
    emoji: '📝',
    enabled: true,
    latencyMs: 8000,
    inputParams: ['data', 'format', 'language'],
  },
  {
    skill: 'telegram-sender',
    name: 'Telegram Dispatch Agent',
    description: 'Sends formatted alerts and reports to Telegram channels or private chats.',
    priceUsdc: '0.002',
    category: 'notification',
    emoji: '📨',
    enabled: true,
    latencyMs: 1500,
    inputParams: ['chat_id', 'message', 'parse_mode'],
  },
  {
    skill: 'social-sentiment',
    name: 'Social Sentiment Monitor',
    description: 'Scans social platforms to score asset sentiment and buzz intensity.',
    priceUsdc: '0.008',
    category: 'research',
    emoji: '💬',
    enabled: true,
    latencyMs: 4500,
    inputParams: ['keyword', 'timeframe'],
  },
  {
    skill: 'document-digest',
    name: 'Document Digest Agent',
    description: 'Fetches external URLs and digests dense research reports or PDFs into key bullets.',
    priceUsdc: '0.01',
    category: 'research',
    emoji: '📚',
    enabled: true,
    latencyMs: 7000,
    inputParams: ['url', 'focus_areas'],
  },
  {
    skill: 'web-intel',
    name: 'Web Intelligence Crawler',
    description: 'LLM-powered search agent executing multi-step search queries via Google SERP API.',
    priceUsdc: '0.01',
    category: 'research',
    emoji: '🕸️',
    enabled: true,
    latencyMs: 6000,
    inputParams: ['query', 'max_depth'],
  },
  {
    skill: 'dca-executor',
    name: 'DCA Strategy Planner',
    description: 'Simulates and optimizes Dollar Cost Average trading plans based on historic volatility.',
    priceUsdc: '0.005',
    category: 'execution',
    emoji: '⏳',
    enabled: true,
    latencyMs: 3500,
    inputParams: ['amount', 'frequency', 'duration'],
  },
  {
    skill: 'polymarket-pulse',
    name: 'Polymarket Pulse Check',
    description: 'Retrieves current betting volumes, outcomes, and odds for prediction markets.',
    priceUsdc: '0.005',
    category: 'research',
    emoji: '🔮',
    enabled: true,
    latencyMs: 2500,
    inputParams: ['market_slug'],
  },
  {
    skill: 'nft-floor-watch',
    name: 'NFT Floor Watcher',
    description: 'Real-time floor price monitoring, volume analysis and mint activity across OpenSea.',
    priceUsdc: '0.005',
    category: 'on-chain',
    emoji: '🖼️',
    enabled: true,
    latencyMs: 3000,
    inputParams: ['collection_slug', 'network'],
  },
  {
    skill: 'email-sender',
    name: 'Email Dispatch Agent',
    description: 'Sends HTML format digests and critical alerts using developer email services.',
    priceUsdc: '0.002',
    category: 'notification',
    emoji: '✉️',
    enabled: true,
    latencyMs: 2000,
    inputParams: ['to', 'subject', 'body'],
  },
  {
    skill: 'market-data-bundle',
    name: 'Market Data Bundle',
    description: 'Parallelized bundle of price scanner, DeFi yields APY checks, Binance technical indicators, and Polymarket odds.',
    priceUsdc: '0.015',
    category: 'research',
    emoji: '📦',
    enabled: true,
    latencyMs: 12000,
    inputParams: ['token_address', 'chain', 'symbol', 'timeframe', 'market_slug', 'query'],
  },
  {
    skill: 'social-lite-bundle',
    name: 'Social Lite Sentiment Bundle',
    description: 'Quick social sentiment checking utilizing Reddit sentiment, deferring slow channels by default.',
    priceUsdc: '0.008',
    category: 'research',
    emoji: '💬',
    enabled: true,
    latencyMs: 8000,
    inputParams: ['topic', 'window_hours'],
  },
  {
    skill: 'report-composer-fast',
    name: 'AI Report Composer Fast',
    description: 'Rapid LLM report composer with timeout constraints and deterministic markdown fallbacks.',
    priceUsdc: '0.010',
    category: 'research',
    emoji: '⚡',
    enabled: true,
    latencyMs: 8000,
    inputParams: ['data', 'tone', 'format'],
  },
]

/** Map for O(1) lookup by skill name */
export const AGENT_ENDPOINT_MAP = new Map<string, AgentEndpoint>(
  AGENT_ENDPOINTS.map((ep) => [ep.skill, ep])
)

/** Get a specific endpoint config */
export function getEndpointConfig(skill: string): AgentEndpoint | null {
  return AGENT_ENDPOINT_MAP.get(skill) ?? null
}

/** Total revenue potential per call (sum of all enabled endpoints) */
export function totalEnabledEndpoints(): number {
  return AGENT_ENDPOINTS.filter((ep) => ep.enabled).length
}
