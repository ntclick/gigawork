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
// Templates
// ════════════════════════════════════════════════════════════════

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // ─── NEWBIE-FIRST (top 3) ─────────────────────────────────────
  {
    id: 'safe-or-rug',
    emoji: '🛡',
    title: 'Safe or Rug?',
    desc: 'Token risk check with traffic-light verdict in 30 seconds.',
    category: 'research',
    skillName: 'crypto-scanner',
    defaults: {
      token_address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
      chain: 'ethereum',
    },
    followupSkills: ['report-composer'],
    uses: ['crypto-scanner', 'report-composer'],
    prompt:
      'Scan this token (paste contract address): 0x6982508145454ce325ddbe47a25d4ec3d2311933 on Ethereum. Then compose a beginner-friendly verdict in casual tone — traffic-light, 3 reasons with numbers, ONE concrete action.',
  },
  {
    id: 'morning-brief',
    emoji: '☕',
    title: 'Morning Brief',
    desc: 'BTC, ETH and SOL pulse — read in 60 seconds.',
    category: 'research',
    freeTextOnly: true,
    uses: ['crypto-scanner', 'trading-signals', 'report-composer'],
    prompt:
      'Daily morning brief: scan BTC, ETH, SOL. Get current price + 24h change + technical signals on 4h timeframe for each. Compose a brief in casual tone for someone with $1000 to deploy: what changed since yesterday, what to watch, what to ignore.',
  },
  {
    id: 'whale-explain',
    emoji: '🐋',
    title: 'Whale Translator',
    desc: 'Track a wallet and explain its moves in plain English.',
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
      'Track wallet 0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503 on Ethereum. Explain who this wallet is, what they are doing, and what a retail trader should take away. NO jargon.',
  },

  // ─── EXECUTION ────────────────────────────────────────────────
  {
    id: 'daily-dca',
    emoji: '📅',
    title: 'Daily DCA',
    desc: 'Plan a daily dollar-cost-average strategy for any asset.',
    category: 'execution',
    skillName: 'dca-executor',
    defaults: {
      asset: 'BTC',
      budget_per_buy_usd: 50,
      frequency: 'daily',
    },
    uses: ['dca-executor', 'crypto-scanner'],
    prompt:
      'Plan a daily DCA strategy for BTC: $50 base buy at 8AM UTC, scale by 1.5× when price < $60k, 0.7× when $70-85k, 0.4× when above $85k.',
  },

  // ─── ON-CHAIN ─────────────────────────────────────────────────
  {
    id: 'whale-tracker',
    emoji: '🐳',
    title: 'Whale Tracker',
    desc: 'Monitor large wallet movements on-chain.',
    category: 'on-chain',
    skillName: 'whale-tracker',
    defaults: {
      wallet: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503',
      network: 'eth-mainnet',
      limit: 25,
    },
    uses: ['whale-tracker'],
    prompt:
      'Track wallet 0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503 on Ethereum. Pull last 25 transfers + top ERC-20 holdings. Flag any single transfer > $100k.',
  },
  {
    id: 'nft-floor',
    emoji: '🎨',
    title: 'NFT Floor Watch',
    desc: 'Track floor price and volume on a collection.',
    category: 'on-chain',
    skillName: 'nft-floor-watch',
    defaults: {
      collection: 'pudgypenguins',
      chain: 'ethereum',
    },
    uses: ['nft-floor-watch'],
    prompt:
      'Watch the Pudgy Penguins NFT collection on Ethereum. Read floor price, 24h volume, owner count, and recent sales.',
  },

  // ─── RESEARCH ─────────────────────────────────────────────────
  {
    id: 'yield-farmer',
    emoji: '🚜',
    title: 'Yield Farmer',
    desc: 'Find and rank the safest stablecoin yields.',
    category: 'research',
    skillName: 'defi-yields',
    defaults: {
      top_n: 10,
      min_tvl_usd: 10_000_000,
      stablecoin_only: true,
    },
    followupSkills: ['report-composer'],
    uses: ['defi-yields', 'report-composer'],
    prompt:
      'Find the safest stablecoin yields across major chains: APY > 8%, TVL > $10M, no IL risk. Rank top 10, then compose a brief comparing top 3.',
  },
  {
    id: 'sentiment-pulse',
    emoji: '📊',
    title: 'Sentiment Pulse',
    desc: 'Track Twitter / Reddit pulse for any ticker.',
    category: 'research',
    skillName: 'social-sentiment',
    defaults: {
      topic: 'Solana',
      window_hours: 24,
      channels: ['twitter', 'reddit'],
    },
    followupSkills: ['web-intel', 'report-composer'],
    uses: ['social-sentiment', 'web-intel', 'report-composer'],
    prompt:
      'Analyze sentiment for $SOL across Twitter and Reddit over the last 24 hours. Pair with web news. Compose a 4-section brief.',
  },
  {
    id: 'token-deep-dive',
    emoji: '🔬',
    title: 'Token Deep Dive',
    desc: 'Full risk, fundamentals and sentiment for any token.',
    category: 'research',
    freeTextOnly: true,
    uses: ['crypto-scanner', 'social-sentiment', 'report-composer'],
    prompt:
      'Run a full investment-grade scan on token 0x6982508145454ce325ddbe47a25d4ec3d2311933 (Ethereum). Pull on-chain stats, then social sentiment 24h, then synthesize into a markdown report with risk score 0-100.',
  },
  {
    id: 'polymarket-pulse',
    emoji: '🎯',
    title: 'Polymarket Pulse',
    desc: 'Probabilities and 24h volume on prediction markets.',
    category: 'research',
    skillName: 'polymarket-pulse',
    defaults: {
      query: 'US election 2026',
      limit: 5,
    },
    followupSkills: ['report-composer'],
    uses: ['polymarket-pulse', 'report-composer'],
    prompt:
      'Scan Polymarket for top 5 markets matching "US election 2026". Show YES/NO probabilities, 24h volume, price drift.',
  },
  {
    id: 'whitepaper-digest',
    emoji: '📄',
    title: 'Whitepaper Digest',
    desc: 'TL;DR plus key risks from any whitepaper URL.',
    category: 'research',
    skillName: 'document-digest',
    defaults: {
      document_url: 'https://ethereum.org/en/whitepaper/',
    },
    followupSkills: ['report-composer'],
    uses: ['document-digest', 'report-composer'],
    prompt:
      'Digest this whitepaper: https://ethereum.org/en/whitepaper/. Return executive summary, key technical innovations, tokenomics, team credibility, and 3 main risks.',
  },
  {
    id: 'news-research',
    emoji: '🌐',
    title: 'Web Research',
    desc: 'Extract structured insights from any topic.',
    category: 'research',
    skillName: 'web-intel',
    defaults: {
      query: 'Base L2 ecosystem growth 2026',
      max_results: 10,
    },
    followupSkills: ['report-composer'],
    uses: ['web-intel', 'report-composer'],
    prompt:
      'Research the topic "Base L2 ecosystem growth 2026" — find top 10 sources from the past 14 days. Extract entities, key claims, TL;DR.',
  },

  // ─── ANALYSIS ─────────────────────────────────────────────────
  {
    id: 'ai-trader',
    emoji: '🤖',
    title: 'AI Trader',
    desc: 'Technical signals plus long / short / neutral verdict.',
    category: 'analysis',
    skillName: 'trading-signals',
    defaults: {
      symbol: 'BTC/USDT',
      timeframe: '4h',
      exchange: 'binance',
    },
    followupSkills: ['report-composer'],
    uses: ['trading-signals', 'crypto-scanner'],
    prompt:
      'Compute RSI(14), MACD, EMA(20/50/200) for BTC/USDT on 4h timeframe (Binance). Give long/short/neutral verdict + reasoning.',
  },
  {
    id: 'cross-chain-arb',
    emoji: '🔁',
    title: 'Cross-chain Arb',
    desc: 'Find price gaps between CEX and DEX.',
    category: 'analysis',
    freeTextOnly: true,
    uses: ['trading-signals', 'crypto-scanner'],
    prompt:
      'Compare WETH spot price across Binance (centralized) and Uniswap V3 (Ethereum). Compute spread + estimated arb profit after gas. Flag if > 0.3%.',
  },

  // ─── NOTIFICATION (free-text) — recipient comes from /settings ─────────
  {
    id: 'email-report',
    emoji: '📧',
    title: 'Email Report',
    desc: 'Run any analysis and email the result to your saved address.',
    category: 'execution',
    freeTextOnly: true, // multi-skill: research → composer → email
    uses: ['report-composer', 'email-sender'],
    prompt:
      'Scan ETH on-chain stats + 4h technical signals, compose a casual brief, then email it to me with subject "ETH morning brief".',
  },
  {
    id: 'telegram-alert',
    emoji: '📨',
    title: 'Telegram Alert',
    desc: 'Push any workflow result to your Telegram chat (set in Settings).',
    category: 'execution',
    freeTextOnly: true,
    uses: ['report-composer', 'telegram-sender'],
    prompt:
      'Track Vitalik wallet 0xab5801a7d398351b8be11c439e05c5b3259aec9b last 24h, summarize, and send to my Telegram.',
  },
]
