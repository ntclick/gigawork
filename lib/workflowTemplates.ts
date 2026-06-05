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
    id: 'token-scanner-telegram',
    emoji: '🔍',
    title: 'Token Scanner & Telegram Alert Team',
    desc: 'Birdeye Scanner Agent analyzes on-chain metrics and transfers the alert to Hermes Telegram Agent for instant risk notification.',
    category: 'research',
    skillName: 'crypto-scanner',
    defaults: {
      token_address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
      chain: 'ethereum',
    },
    followupSkills: ['report-composer', 'telegram-sender'],
    uses: ['crypto-scanner', 'report-composer', 'telegram-sender'],
    prompt:
      'Scan on-chain metrics of token 0x6982508145454ce325ddbe47a25d4ec3d2311933 on ethereum using Birdeye Scanner Agent, compile a report and dispatch an automated alert to my phone via Telegram Agent.',
  },
  {
    id: 'defi-yield-finder',
    emoji: '🌾',
    title: 'DeFi Yield APY Hunter Team',
    desc: 'Yield Finder Agent scans DeFi protocols for high APY pools and hands over the yield analysis to Composer Agent for profit optimization reporting.',
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
  },
  {
    id: 'trading-signals-email',
    emoji: '📈',
    title: 'Technical Signals Reporter Team',
    desc: 'Binance Analyst Agent calculates RSI/MACD indicators for BTC/ETH and coordinates with Mailman Agent to email the signals report.',
    category: 'execution',
    skillName: 'trading-signals',
    defaults: {
      symbol: 'BTC/USDT',
      timeframe: '4h',
      exchange: 'binance',
    },
    followupSkills: ['report-composer', 'email-sender'],
    uses: ['trading-signals', 'report-composer', 'email-sender'],
    prompt:
      'Analyze RSI/MACD technical indicators for BTC/USDT 4h chart on Binance using Analyst Agent, compile a signals report and send it to my email.',
  },
  {
    id: 'whale-tracker-report',
    emoji: '🐳',
    title: 'Whale Tracker & Flow Analyst Team',
    desc: 'Whale Tracker Agent tracks large on-chain transactions of a whale address to analyze accumulation or distribution behaviors.',
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
  },
]
