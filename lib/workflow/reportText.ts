/**
 * lib/workflow/reportText.ts
 *
 * Pulls the final deliverable markdown out of a workflow's message
 * trajectory. Pure, no side effects.
 *
 * Distilled from the old FocusedStepList extractor, keeping only the
 * paths that read a report the backend actually produced. Deliberately
 * dropped from that version:
 *   - the markdown→HTML conversion (the console renders markdown as
 *     markdown)
 *   - the "if the report looks brief, append the agent findings" step,
 *     which synthesised report content client-side
 *   - the "any assistant message over 100 chars" fallback, which happily
 *     promoted planner chatter into the deliverable slot
 */

/** Loose shape — messages come from the AI SDK and vary by version. */
interface LooseMessage {
  role?: string
  content?: unknown
  parts?: unknown[]
}

const REPORT_HINTS = [
  '## Executive Summary',
  '## Evidence',
  '## 🎯 Executive Summary',
  // Sections of the current verdict-first composer format.
  '## Numbers',
  '## Watch out',
  '## Do next',
]

/**
 * The old test was `startsWith('# ')` or one of the legacy headings. When
 * the composer moved to a verdict-first format — a bold line, then
 * "## Numbers" — every report started failing this check and the run
 * rendered "finished without producing a report" despite having one.
 *
 * So: match the known headings, and otherwise accept any text carrying two
 * or more markdown section headings. That is still far tighter than the
 * "any assistant message over 100 chars" fallback this replaced, which
 * promoted planner chatter into the deliverable slot.
 */
function looksLikeReport(text: string): boolean {
  const t = text.trim()
  if (t.length <= 50) return false
  if (t.startsWith('# ')) return true
  if (REPORT_HINTS.some((h) => t.includes(h))) return true
  return (t.match(/^##\s+\S/gm) ?? []).length >= 2
}

function readToolMarkdown(part: Record<string, unknown>): string | null {
  const out = (part.output ?? {}) as Record<string, unknown>
  const inp = (part.input ?? {}) as Record<string, unknown>
  const md =
    out.summary_markdown ?? inp.summary_markdown ?? out.markdown ?? inp.markdown
  return typeof md === 'string' && md.trim().length > 30 ? md : null
}

/**
 * Returns the deliverable markdown, or null when the run hasn't produced
 * one. Null means "no report yet" — callers must render an honest empty
 * state rather than substituting anything.
 */
export function extractReportMarkdown(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null
  const list = messages as LooseMessage[]

  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]

    if (typeof m?.content === 'string' && looksLikeReport(m.content)) {
      return m.content.trim()
    }

    if (Array.isArray(m?.parts)) {
      for (let j = m.parts.length - 1; j >= 0; j--) {
        const p = m.parts[j] as Record<string, unknown>
        if (!p || typeof p !== 'object') continue

        if (p.type === 'tool-finalizeReport' || p.type === 'tool-auto_finalize') {
          const md = readToolMarkdown(p)
          if (md) return md
        }

        if (p.type === 'text' && typeof p.text === 'string' && looksLikeReport(p.text)) {
          return (p.text as string).trim()
        }
      }
    }
  }

  return null
}
