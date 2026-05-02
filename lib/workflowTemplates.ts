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
  },

  // ─── POLYMARKET ───────────────────────────────────────────────
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

  // ─── SCHEDULE / DCA ───────────────────────────────────────────
  {
    id: 'daily-dca',
    emoji: '📅',
    title: 'Daily DCA',
    desc: 'Plan a scheduled DCA strategy with tiered buys around live price.',
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
]
