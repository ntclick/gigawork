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
// Templates
// ════════════════════════════════════════════════════════════════

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // ─── POLYMARKET ───────────────────────────────────────────────
  {
    id: 'polymarket-odds',
    emoji: '🎯',
    title: 'Polymarket Odds Monitor',
    desc: 'YES/NO probabilities and 24h volume on prediction markets.',
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
    id: 'polymarket-address',
    emoji: '🪪',
    title: 'Polymarket Address Monitor',
    desc: 'Track positions + recent trades of a specific Polymarket trader.',
    category: 'on-chain',
    freeTextOnly: true,
    uses: ['whale-tracker', 'polymarket-pulse', 'report-composer'],
    prompt:
      'Track Polymarket trader at wallet 0x... — pull their last 25 transfers via whale-tracker, cross-reference open Polymarket markets they touched, then compose a brief on their thesis.',
    slottedPrompt:
      'Track Polymarket trader at wallet ${wallet:0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503} — pull their last 25 transfers via whale-tracker on ${chain:ethereum}, cross-reference open Polymarket markets they touched, then compose a brief on their thesis.',
  },

  // ─── DCA / LADDER (scheduled buys) ────────────────────────────
  {
    id: 'daily-dca',
    emoji: '📅',
    title: 'DCA (Dollar Cost Averaging)',
    desc: 'Scheduled tiered buys around live spot price — daily / weekly / hourly.',
    category: 'execution',
    skillName: 'dca-executor',
    defaults: {
      asset: 'BTC',
      budget_per_buy_usd: 50,
      frequency: 'daily',
    },
    followupSkills: ['report-composer'],
    uses: ['dca-executor', 'report-composer'],
    prompt:
      'Plan a daily DCA strategy for BTC: $50 base buy at 8AM UTC, scale up when price drops, scale down when it rips. Compose a one-page summary.',
  },
  {
    id: 'ladder-buy-sell',
    emoji: '🪜',
    title: 'Ladder Buy & Sell',
    desc: 'Layered limit orders across price tiers. Returns a ready-to-place ladder.',
    category: 'execution',
    skillName: 'dca-executor',
    defaults: {
      asset: 'ETH',
      budget_per_buy_usd: 200,
      frequency: 'weekly',
    },
    followupSkills: ['report-composer'],
    uses: ['dca-executor', 'trading-signals', 'report-composer'],
    prompt:
      'Build a buy/sell ladder for ETH around live spot. Pair with 4h trading signals so each tier has a confidence note. Output a clean table.',
  },

  // ─── ON-CHAIN MONITOR ─────────────────────────────────────────
  {
    id: 'wallet-monitor',
    emoji: '👁️',
    title: 'Wallet Monitor',
    desc: 'Watch a wallet — balances, top tokens, recent transfers, big-move alerts.',
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
      'Monitor wallet 0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503 on Ethereum: native + top ERC-20 balances, last 25 transfers, flag anything > $100k. Compose a plain-English digest.',
  },
  {
    id: 'copy-trade',
    emoji: '🔁',
    title: 'Copy Trade',
    desc: 'Detect a smart wallet\'s last buys; surface ones you could replicate.',
    category: 'on-chain',
    freeTextOnly: true,
    uses: ['whale-tracker', 'crypto-scanner', 'report-composer'],
    prompt:
      'Track wallet 0xab5801a7d398351b8be11c439e05c5b3259aec9b — pull last 25 transfers, run crypto-scanner on each unique token they bought, then compose a verdict on which 2-3 are worth copying based on liquidity + holder concentration.',
    slottedPrompt:
      'Track wallet ${wallet:0xab5801a7d398351b8be11c439e05c5b3259aec9b} on ${chain:ethereum} — pull last 25 transfers, run crypto-scanner on each unique token they bought, then compose a verdict on which 2-3 are worth copying based on liquidity + holder concentration.',
  },

  // ─── NOTIFICATION ─────────────────────────────────────────────
  {
    id: 'send-alert',
    emoji: '📨',
    title: 'Send Alert',
    desc: 'Run any analysis and push the result to your email or Telegram.',
    category: 'execution',
    freeTextOnly: true,
    uses: ['report-composer', 'email-sender', 'telegram-sender'],
    prompt:
      'Scan BTC + ETH 4h technical signals, compose a casual brief, then send it to my saved email AND telegram with subject "Daily crypto pulse".',
    slottedPrompt:
      'Scan $BTC + $ETH ${timeframe:24h} technical signals on ${chain:ethereum}, compose a casual brief, then send it to my saved email AND telegram with subject "Daily crypto pulse".',
  },

  // ─── Quick token + sentiment scan (slotted-first template) ────
  {
    id: 'token-pulse',
    emoji: '📡',
    title: 'Token Pulse',
    desc: 'Pick any token + chain + timeframe — get price, on-chain activity, social sentiment.',
    category: 'research',
    freeTextOnly: true,
    uses: ['crypto-scanner', 'social-sentiment', 'report-composer'],
    prompt:
      'Scan BTC on ethereum and check 24h sentiment + on-chain activity, then compose a one-page brief.',
    slottedPrompt:
      'Scan $BTC on ${chain:ethereum} and check ${timeframe:24h} sentiment + on-chain activity, then compose a one-page brief.',
  },
]
