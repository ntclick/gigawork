'use client'

import { useMemo } from 'react'
import { isToolUIPart, type UIMessage } from 'ai'

import { MarkdownTypewriter } from './Typewriter'

/**
 * WorkflowDocPanel — right rail on the workflow editor.
 *
 * Renders the brain's output as live documentation:
 *  - Title (workflow name)
 *  - Description (first user prompt)
 *  - "How it works" steps (auto-derived from plan nodes)
 *  - Brain's `finalizeReport.summary_markdown` rendered as full markdown
 *  - Live status pill at the top while running
 *
 * No chat bubbles — this is the documentation view, not a chat thread.
 * (The canvas reflects per-step state visually so a chat thread is redundant.)
 */
export function WorkflowDocPanel({
  title,
  prompt,
  messages,
  status,
}: {
  title: string
  prompt?: string
  messages: UIMessage[]
  status: string
}) {
  const { plan, finalReport, dispatchStats } = useMemo(() => extract(messages), [messages])

  const busy = status === 'streaming' || status === 'submitted'

  return (
    <aside className="giga-theme hidden w-96 shrink-0 overflow-y-auto border-l border-black bg-[var(--giga-panel)] p-6 lg:block">
      {/* Live status banner */}
      <StatusBanner busy={busy} dispatchStats={dispatchStats} hasReport={!!finalReport} />

      <h2
        className="font-pixel-body mt-2 mb-1 break-words text-2xl uppercase leading-tight md:text-3xl"
        style={{ wordBreak: 'break-word' }}
      >
        {title}
      </h2>
      {prompt && (
        <p className="mb-5 break-words text-xs leading-snug text-white/55 md:text-sm">
          {truncate(prompt, 220)}
        </p>
      )}

      <div className="space-y-6">
        {/* Description (first paragraph from brain or fallback) */}
        <section>
          <h3 className="mb-2 border-b border-gray-700 pb-2 text-base font-semibold uppercase tracking-wider md:text-lg">
            Documentation
          </h3>
          <p className="text-sm leading-relaxed text-white/75 md:text-[15px]">
            {finalReport
              ? extractFirstParagraph(finalReport)
              : busy
                ? 'Hermes brain is analyzing the request and planning the execution…'
                : 'Workflow not started yet. Send a prompt and the brain will pick agents + run them.'}
          </p>
        </section>

        {/* How it works — derived from plan nodes (compact, scannable) */}
        {plan.length > 0 && (
          <section>
            <h3 className="mb-2 border-b border-gray-700 pb-2 text-base font-semibold uppercase tracking-wider md:text-lg">
              How it works
            </h3>
            <ol className="space-y-2.5 text-[13px] leading-snug text-white/80 md:text-sm">
              {plan.map((n, i) => (
                <li key={n.plan_id} className="flex gap-2">
                  <span className="shrink-0 font-mono text-[11px] text-[var(--giga-accent)]">
                    {String(i + 1).padStart(2, '0')}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-white/90" style={{ wordBreak: 'break-word' }}>
                      {n.label}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-[10px] text-purple-300/65">
                      → {n.skill_name}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Full markdown report (typewriter reveal when finalized) */}
        {finalReport && (
          <section className="border-t border-gray-700 pt-5">
            <h3 className="mb-3 text-xl text-[var(--giga-accent)]">Report</h3>
            <MarkdownTypewriter text={finalReport} />
          </section>
        )}

        {/* Empty state */}
        {plan.length === 0 && !finalReport && !busy && (
          <section className="rounded-md border border-white/10 bg-white/[0.02] p-4 text-center text-sm text-white/45">
            Brain chưa tạo plan. Gửi message từ bottom bar để bắt đầu.
          </section>
        )}
      </div>
    </aside>
  )
}

function StatusBanner({
  busy,
  dispatchStats,
  hasReport,
}: {
  busy: boolean
  dispatchStats: { running: number; completed: number; failed: number; total: number }
  hasReport: boolean
}) {
  if (!busy && !hasReport) return null
  if (hasReport && !busy) {
    return (
      <div className="mb-4 inline-flex items-center gap-2 border-2 border-[#3e6a62] bg-[#1f3632] px-3 py-1.5 text-xs">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="text-emerald-300">✓ Workflow complete</span>
      </div>
    )
  }
  if (busy) {
    return (
      <div className="mb-4 inline-flex items-center gap-2 border-2 border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 px-3 py-1.5 text-xs">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--giga-accent)]" />
        <span className="text-[var(--giga-accent)]">
          Running step {dispatchStats.completed + dispatchStats.failed + 1}
          {dispatchStats.total > 0 ? ` / ${dispatchStats.total}` : ''}
        </span>
      </div>
    )
  }
  return null
}

function extract(messages: UIMessage[]) {
  type PlanNode = {
    node_id: string
    plan_id: string
    label: string
    skill_name: string
    depends_on: string[]
  }

  let plan: PlanNode[] = []
  let finalReport: string | null = null
  let running = 0
  let completed = 0
  let failed = 0
  let total = 0

  for (const m of messages) {
    for (const part of m.parts) {
      if (!isToolUIPart(part)) continue
      const toolName = part.type.replace(/^tool-/, '')
      if (toolName === 'planWorkflow' && part.state === 'output-available') {
        const out = part.output as { nodes?: PlanNode[] } | undefined
        if (out?.nodes?.length) {
          plan = out.nodes
          total = out.nodes.length
        }
      }
      if (toolName === 'dispatchSkill') {
        if (part.state === 'output-available') {
          const out = part.output as { ok?: boolean } | undefined
          if (out?.ok === false) failed++
          else completed++
        } else if (part.state === 'input-streaming' || part.state === 'input-available') {
          running++
        }
      }
      if (toolName === 'finalizeReport' && part.state === 'output-available') {
        const input = part.input as { summary_markdown?: string } | undefined
        if (input?.summary_markdown) finalReport = input.summary_markdown
      }
    }
  }

  return {
    plan,
    finalReport,
    dispatchStats: { running, completed, failed, total },
  }
}

function extractFirstParagraph(md: string): string {
  // Strip markdown header/list syntax for the summary line
  const lines = md.split(/\r?\n/)
  for (const ln of lines) {
    const t = ln.trim().replace(/^#+\s*/, '').replace(/^[-*]\s*/, '')
    if (t.length > 20) return t.length > 220 ? t.slice(0, 220) + '…' : t
  }
  return md.slice(0, 220)
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}
