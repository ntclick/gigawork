/**
 * Workflow templates surfaced on the home page.
 *
 * Each template either:
 *   (a) maps to a primary skill (`skillName` set) — UI auto-renders a form
 *       from `skill.manifest.input_schema`, pre-fills `defaults`, then
 *       serializes a structured envelope into the brain prompt:
 *
 *           [INTENT=<id> via <skill_name>]
 *           <param>: <value>
 *           ...
 *           User note: "<optional free text>"
 *
 *       Brain recognizes the envelope and dispatches the named skill with
 *       params directly — no prose-parsing, no input: {} guesses.
 *
 *   (b) free-text only (`freeTextOnly: true`) — for multi-skill / open-ended
 *       prompts where Kimi should plan from prose. UI renders the card
 *       in classic "click to fill prompt" mode (legacy behavior).
 *
 * `followupSkills` is a hint to the brain — it will plan a node for each
 * after the primary, typically ending with `report-composer`.
 */

export interface WorkflowTemplate {
  id: string
  emoji: string
  title: string
  desc: string
  category: 'execution' | 'on-chain' | 'research' | 'analysis'

  /** Skill whose input_schema is rendered as a form. Omit for free-text. */
  skillName?: string

  /** Pre-fill values keyed by input_schema property name. */
  defaults?: Record<string, unknown>

  /** Skills the brain should chain after the primary. */
  followupSkills?: string[]

  /** When true, render as classic prompt card (no form). */
  freeTextOnly?: boolean

  /**
   * Used in two cases:
   *  - `freeTextOnly: true` → exact prompt to load into textarea
   *  - structured templates → fallback prompt if user hits "Skip form"
   *    Also shown as a hint in the form's "User note" placeholder.
   */
  prompt: string

  /**
   * NEW: cloze-style prompt with editable variable slots. When set, clicking
   * the card loads it into the EditablePrompt component instead of the raw
   * textarea — user clicks colored chips to swap tokens/chains/timeframes
   * without typing free text.
   *
   * Grammar:
   *   - $BTC          → token slot (uppercase cashtag, 1-10 chars)
   *   - ${chain:eth}  → enum slot, value is the default
   *   - Other kinds: timeframe, wallet, address, number, text
   *
   * Falls back to `prompt` if undefined. See lib/slottedPrompt.ts for the
   * parser + supported kinds.
   */
  slottedPrompt?: string

  /** Skills exercised — informational chip on the card (display only). */
  uses: string[]
}

// ════════════════════════════════════════════════════════════════
// Helpers (form serializer used by TemplateForm)
// ════════════════════════════════════════════════════════════════

/**
 * Serialize a structured form submission into the envelope format the
 * brain understands. Keep keys sorted for determinism (helps caching).
 */
export function buildEnvelope(opts: {
  templateId: string
  skillName: string
  followupSkills?: string[]
  params: Record<string, unknown>
  userNote?: string
}): string {
  const { templateId, skillName, followupSkills, params, userNote } = opts
  const lines: string[] = []

  // Action-imperative first line so Kimi treats this as a real request,
  // not a metadata blob. The structured envelope follows.
  const followText = followupSkills?.length
    ? ` then chain through ${followupSkills.join(' → ')}`
    : ''
  lines.push(`Run ${skillName} with the params below${followText}, then finalize a report.`)
  lines.push('')
  lines.push(`[INTENT=${templateId} via ${skillName}]`)
  for (const k of Object.keys(params).sort()) {
    const v = params[k]
    if (v === undefined || v === null || v === '') continue
    lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  }
  if (followupSkills && followupSkills.length > 0) {
    lines.push(`followup_skills: ${followupSkills.join(', ')}`)
  }
  if (userNote && userNote.trim()) {
    lines.push('')
    lines.push(`User note: "${userNote.trim()}"`)
  }
  return lines.join('\n')
}

// ════════════════════════════════════════════════════════════════
// Templates (Multi-Agent Team Templates in Friendly Vietnamese)
// ════════════════════════════════════════════════════════════════

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'defi-yield-finder',
    emoji: '🌾',
    title: 'DeFi Yield APY Hunter & Portfolio Optimizer',
    desc: 'Yield Finder Agent scans DeFi protocols across Ethereum, Arbitrum & Solana for highest stablecoin APY pools (TVL > $1M), analyzed by Risk Evaluator & compiled into an optimized yield report.',
    category: 'analysis',
    skillName: 'defi-yields',
    defaults: {
      top_n: 5,
      min_tvl_usd: 1000000,
      stablecoin_only: true,
    },
    followupSkills: ['report-composer'],
    uses: ['defi-yields', 'report-composer'],
    prompt:
      'Hunt DeFi pools for top 5 highest APY yields with TVL > 1M USD, stablecoins only, using Yield Finder Agent and compose a yield optimization report.',
    slottedPrompt:
      'Hunt DeFi pools for top 5 highest APY yields with TVL > 1M USD, stablecoins only, using Yield Finder Agent and compose a yield optimization report.',
  },
  {
    id: 'token-scanner-valuation',
    emoji: '🔍',
    title: 'Token On-Chain Security & Valuation Radar',
    desc: 'Crypto Token Scanner scans verified on-chain metrics, DEX liquidity depth, and holder distribution from CoinGecko, DexScreener & Birdeye, analyzed by Trading Signals & compiled into an institutional report.',
    category: 'research',
    skillName: 'crypto-scanner',
    // `symbol` was here too — crypto-scanner has no such param (its schema
    // is chain + token_address, token_address required), so it was silently
    // dropped on dispatch. Kept out rather than renamed: the address below
    // already identifies the token.
    defaults: {
      token_address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
      chain: 'ethereum',
    },
    followupSkills: ['trading-signals', 'report-composer'],
    uses: ['crypto-scanner', 'trading-signals', 'report-composer'],
    prompt:
      'Scan on-chain security metrics & DEX liquidity for $PEPE (0x6982508145454ce325ddbe47a25d4ec3d2311933) on Ethereum via CoinGecko & DexScreener, calculate technical momentum indicators, and compile an institutional valuation & security report.',
    slottedPrompt:
      'Scan on-chain metrics and valuation for $PEPE on Ethereum via CoinGecko & DexScreener, calculate technical momentum indicators, and compile an institutional valuation & security report.',
  },
  {
    id: 'trading-signals-sentinel',
    emoji: '📈',
    title: 'Multi-Timeframe Technical Signals Sentinel',
    desc: 'Trading Signals Analyst calculates RSI, MACD, and Momentum indicators for BTC/ETH across 4h & 1d Binance orderbooks, verified by On-Chain Liquidity & compiled into an actionable signals brief.',
    category: 'execution',
    skillName: 'trading-signals',
    defaults: {
      symbol: 'BTC/USDT',
      timeframe: '4h',
      exchange: 'binance',
    },
    followupSkills: ['crypto-scanner', 'report-composer'],
    uses: ['trading-signals', 'crypto-scanner', 'report-composer'],
    prompt:
      'Analyze RSI/MACD technical momentum indicators for BTC/USDT and ETH/USDT on Binance, verify market liquidity depth, and compile an actionable market signals brief.',
    slottedPrompt:
      'Analyze RSI/MACD technical momentum indicators for $BTC 4h chart on Binance, verify market liquidity depth, and compile an actionable market signals brief.',
  },
  {
    id: 'whale-tracker-report',
    emoji: '🐳',
    title: 'Smart Money Whale Wallet & Accumulation Flow',
    desc: 'Whale Tracker Agent tracks high-value ($100k+) transactions from Ethereum smart money wallets to detect accumulation vs distribution trends.',
    category: 'on-chain',
    skillName: 'whale-tracker',
    defaults: {
      wallet: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503',
      network: 'eth-mainnet',
      limit: 25,
    },
    followupSkills: ['report-composer'],
    uses: ['whale-tracker', 'report-composer'],
    prompt:
      'Track 25 recent transactions of wallet 0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503 on eth-mainnet using Whale Tracker Agent, analyze buy/sell flows and compile a report.',
    slottedPrompt:
      'Track 25 recent transactions of wallet 0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503 on eth-mainnet using Whale Tracker Agent and analyze accumulation flows.',
  },
  {
    id: 'polymarket-pulse',
    emoji: '⚡',
    title: 'Polymarket Prediction Odds & Macro Sentiment',
    desc: 'Polymarket Pulse Agent extracts live market odds and liquidity depth across macro policy & crypto prediction markets for sentiment analysis.',
    category: 'analysis',
    skillName: 'polymarket-pulse',
    // The param is `query` (and it is REQUIRED), not `topic`. With `topic`
    // the required field never arrived, so the skill fell back to whatever
    // it does with a missing query rather than searching crypto markets.
    defaults: {
      query: 'crypto',
      limit: 10,
    },
    followupSkills: ['report-composer'],
    uses: ['polymarket-pulse', 'report-composer'],
    prompt:
      'Scan Polymarket prediction odds for crypto markets, analyze sentiment probabilities and compose a macro pulse report.',
    slottedPrompt:
      'Scan Polymarket prediction odds for crypto markets, analyze sentiment probabilities and compose a macro pulse report.',
  },
  {
    id: 'nft-floor-watch',
    emoji: '💎',
    title: 'OpenSea NFT Floor Price & Liquidity Sentinel',
    desc: 'Floor Watch Agent retrieves OpenSea floor prices, 24h trading volume, and listing velocity for top NFT collections.',
    category: 'research',
    skillName: 'nft-floor-watch',
    // The param is `collection` (REQUIRED), not `collection_slug` — so the
    // one field this skill cannot run without was never being passed.
    defaults: {
      collection: 'pudgypenguins',
    },
    followupSkills: ['report-composer'],
    uses: ['nft-floor-watch', 'report-composer'],
    prompt:
      'Retrieve OpenSea floor price and 24h volume stats for pudgypenguins collection using Floor Watch Agent and compile a report.',
    slottedPrompt:
      'Retrieve OpenSea floor price and 24h volume stats for pudgypenguins collection using Floor Watch Agent and compile a report.',
  },

  // ── Added to cover the skills the first six never touched ──────────
  // web-intel, social-sentiment, social-lite-bundle, document-digest,
  // wallet-risk-checker, dca-executor, market-data-bundle and the two
  // notification senders all existed in the registry with no template
  // exercising them, so a demo could never reach them.

  {
    id: 'web-research-brief',
    emoji: '📰',
    title: 'Web Research Brief',
    desc: 'Search the live web on any topic, filter to recent sources, and return a short brief with the findings and where each came from.',
    category: 'research',
    skillName: 'web-intel',
    defaults: { query: 'Ethereum L2 fee trends', max_results: 8, freshness_days: 14 },
    followupSkills: ['report-composer'],
    uses: ['web-intel', 'report-composer'],
    prompt:
      'Search the web for recent coverage of Ethereum L2 fee trends, take the 8 best sources from the last 14 days, and write a short brief.',
  },
  {
    id: 'social-sentiment-scan',
    emoji: '💬',
    title: 'Social Sentiment Scan',
    desc: 'Score how a topic is being talked about across social channels over a chosen window, then summarise the mood and what is driving it.',
    category: 'research',
    skillName: 'social-sentiment',
    defaults: { topic: 'bitcoin', window_hours: 24 },
    followupSkills: ['report-composer'],
    uses: ['social-sentiment', 'report-composer'],
    prompt:
      'Score social sentiment for bitcoin over the last 24 hours and summarise the mood with what is driving it.',
  },
  {
    id: 'document-digest',
    emoji: '📄',
    title: 'Document Digest',
    desc: 'Point it at a URL — whitepaper, docs page, long article — and get the argument back in a few hundred words with the key quotes kept.',
    category: 'research',
    skillName: 'document-digest',
    defaults: {
      document_url: 'https://ethereum.org/en/roadmap/',
      max_words: 400,
      include_quotes: true,
    },
    followupSkills: ['report-composer'],
    uses: ['document-digest', 'report-composer'],
    prompt:
      'Digest https://ethereum.org/en/roadmap/ into under 400 words, keeping the key quotes, and write it up.',
  },
  {
    id: 'market-data-sweep',
    emoji: '📊',
    title: 'Market Data Sweep',
    desc: 'One call pulls price, chart and market context for an asset, then a report ties the numbers into a single read on where it stands.',
    category: 'analysis',
    skillName: 'market-data-bundle',
    defaults: { symbol: 'ETH/USDT', timeframe: '4h', chain: 'ethereum' },
    followupSkills: ['report-composer'],
    uses: ['market-data-bundle', 'report-composer'],
    prompt:
      'Pull the full market data bundle for ETH/USDT on the 4h timeframe and write a report on where it stands.',
  },
  {
    id: 'social-vs-price',
    emoji: '🔀',
    title: 'Social Mood vs Price Action',
    desc: 'Reads the crowd and the chart side by side, so you can see whether sentiment is leading the price or just following it.',
    category: 'analysis',
    skillName: 'social-lite-bundle',
    defaults: { topic: 'ethereum', window_hours: 24 },
    followupSkills: ['trading-signals', 'report-composer'],
    uses: ['social-lite-bundle', 'trading-signals', 'report-composer'],
    prompt:
      'Compare social mood for ethereum over 24h against ETH/USDT 4h technical signals, and say whether sentiment is leading or following price.',
  },
  {
    id: 'wallet-risk-check',
    emoji: '🛡️',
    title: 'Wallet Risk Check',
    desc: 'Run an address through a risk screen before you deal with it, and get the verdict with the reasoning rather than just a score.',
    category: 'on-chain',
    skillName: 'wallet-risk-checker',
    defaults: { query: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
    followupSkills: ['report-composer'],
    uses: ['wallet-risk-checker', 'report-composer'],
    prompt:
      'Run a risk check on wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 and explain the verdict.',
  },
  {
    id: 'whale-and-security',
    emoji: '🐋',
    title: 'Whale Flow + Token Security',
    desc: 'Pairs who is moving size in a token with what the contract itself looks like, so a busy chart and a risky contract do not get confused.',
    category: 'on-chain',
    skillName: 'whale-tracker',
    defaults: { chain: 'eth-mainnet', min_usd: 250000 },
    followupSkills: ['crypto-scanner', 'report-composer'],
    uses: ['whale-tracker', 'crypto-scanner', 'report-composer'],
    prompt:
      'Track whale transfers over $250k on Ethereum, scan the tokens involved for contract risk, and report on both together.',
  },
  {
    id: 'dca-ladder-plan',
    emoji: '🪜',
    title: 'DCA Ladder Planner',
    desc: 'Builds a tiered buy ladder around the current price — more size lower down, less near the top — with the bands written out.',
    category: 'execution',
    skillName: 'dca-executor',
    defaults: { asset: 'ETH', frequency: 'weekly', budget_per_buy_usd: 100 },
    followupSkills: ['trading-signals', 'report-composer'],
    uses: ['dca-executor', 'trading-signals', 'report-composer'],
    prompt:
      'Build a weekly $100 DCA ladder for ETH, check it against current 4h signals, and write out the price bands.',
  },
  {
    id: 'daily-digest-telegram',
    emoji: '📲',
    title: 'Daily Digest → Telegram',
    // Wording matters here: the executor has a hard guard that SKIPS
    // email-sender/telegram-sender on any manual run — they fire only from
    // a scheduled Deploy. Saying "needs a bot token saved in Deploy"
    // implied that saving credentials was enough, so clicking this card
    // looked like it would deliver and never could.
    desc: 'Sweeps the market and writes a short digest. Clicking runs it here; the Telegram send only fires once you schedule it from Deploy.',
    category: 'execution',
    skillName: 'market-data-bundle',
    defaults: { symbol: 'BTC/USDT', timeframe: '1d' },
    followupSkills: ['report-composer', 'telegram-sender'],
    uses: ['market-data-bundle', 'report-composer', 'telegram-sender'],
    prompt:
      'Sweep BTC/USDT daily market data, write a short digest, and send it to my Telegram.',
  },
  {
    id: 'yield-report-email',
    emoji: '✉️',
    title: 'Yield Report → Email',
    desc: 'Same yield hunt as the DeFi template. Clicking shows the report here; the email only goes out once you schedule it from Deploy.',
    category: 'execution',
    skillName: 'defi-yields',
    defaults: { top_n: 5, min_tvl_usd: 1000000, stablecoin_only: true },
    followupSkills: ['report-composer', 'email-sender'],
    uses: ['defi-yields', 'report-composer', 'email-sender'],
    prompt:
      'Find the top 5 stablecoin yield pools over $1M TVL, write a report, and email it to me.',
  },
]
