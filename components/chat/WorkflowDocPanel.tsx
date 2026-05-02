'use client'

import { useMemo } from 'react'
import { isToolUIPart, type UIMessage } from 'ai'
import { BookOpen, FileText, ListChecks, Sparkles } from 'lucide-react'

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
        {/* Description — only when there's no report yet (otherwise the
            report's own intro paragraph carries the description). */}
        {!finalReport && (
          <section>
            <SectionHeading icon={<BookOpen className="h-3.5 w-3.5" />}>
              Mô tả
            </SectionHeading>
            <p className="text-sm leading-relaxed text-white/75 md:text-[15px]">
              {busy
                ? 'Hermes brain đang phân tích request và lên plan…'
                : 'Workflow chưa chạy. Gửi prompt từ bottom bar để brain tự chọn agent.'}
            </p>
          </section>
        )}

        {/* How it works — compact action list derived from plan nodes */}
        {plan.length > 0 && (
          <section>
            <SectionHeading icon={<ListChecks className="h-3.5 w-3.5" />}>
              Cách hoạt động
            </SectionHeading>
            <ol className="space-y-2 text-[13px] leading-snug text-white/85 md:text-sm">
              {plan.map((n, i) => (
                <li
                  key={n.plan_id}
                  className="flex gap-2.5 border-l-2 border-[var(--giga-accent)]/30 pl-2.5"
                >
                  <span className="shrink-0 font-mono text-[11px] text-[var(--giga-accent)]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-white/95" style={{ wordBreak: 'break-word' }}>
                      {n.label}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-[10px] text-purple-300/60">
                      → {n.skill_name}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Full markdown report — supports tables / bullets / headers via
            remark-gfm. Typewriter reveal only happens once; afterwards it
            stays static. */}
        {finalReport && (
          <section className="border-t border-white/10 pt-5">
            <SectionHeading
              icon={<FileText className="h-3.5 w-3.5" />}
              accent
            >
              Báo cáo
            </SectionHeading>
            <MarkdownTypewriter
              text={finalReport}
              className="gw-md text-sm leading-relaxed text-white/90 md:text-[15px]"
            />
          </section>
        )}

        {/* Empty state */}
        {plan.length === 0 && !finalReport && !busy && (
          <section className="border-2 border-dashed border-white/10 bg-white/[0.02] p-4 text-center text-sm text-white/50">
            <Sparkles className="mx-auto mb-2 h-4 w-4 text-[var(--giga-accent)]" />
            Brain chưa tạo plan. Gửi message từ bottom bar để bắt đầu.
          </section>
        )}
      </div>
    </aside>
  )
}

function SectionHeading({
  icon,
  accent,
  children,
}: {
  icon?: React.ReactNode
  accent?: boolean
  children: React.ReactNode
}) {
  return (
    <h3
      className={`mb-3 flex items-center gap-2 border-b border-white/10 pb-2 text-[11px] font-bold uppercase tracking-[0.18em] ${
        accent ? 'text-[var(--giga-accent)]' : 'text-white/70'
      }`}
    >
      {icon && (
        <span
          className={`inline-flex h-5 w-5 items-center justify-center border ${
            accent
              ? 'border-[var(--giga-accent)]/40 bg-[var(--giga-accent)]/10 text-[var(--giga-accent)]'
              : 'border-white/15 bg-white/[0.03] text-white/65'
          }`}
        >
          {icon}
        </span>
      )}
      {children}
    </h3>
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

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}
