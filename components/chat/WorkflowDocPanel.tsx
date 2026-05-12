'use client'

import { useMemo } from 'react'
import { isToolUIPart, type UIMessage } from 'ai'
import { BookOpen, ExternalLink, FileText, Hexagon, ListChecks, Sparkles } from 'lucide-react'

import { MarkdownTypewriter } from './Typewriter'

export interface Erc8183Trail {
  jobId: string | null
  createTx: string | null
  // Plan A — admin-signed setBudget after createJob lands. Null when the
  // legacy admin-self-loop posted the job, since that path bundles
  // setBudget invisibly into openAndFundJob.
  setBudgetTx: string | null
  approveTx: string | null
  fundTx: string | null
  submitTx: string | null
  completeTx: string | null
  deliverableHash: string | null
  budgetUsdc: string | null
}

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
  erc8183,
}: {
  title: string
  prompt?: string
  messages: UIMessage[]
  status: string
  erc8183?: Erc8183Trail | null
}) {
  const { plan, finalReport, dispatchStats, dispatches, reputationTx } = useMemo(() => extract(messages), [messages])

  const busy = status === 'streaming' || status === 'submitted'

  return (
    <aside className="giga-theme hidden w-96 shrink-0 overflow-y-auto border-l border-black bg-[var(--giga-panel)] p-6 lg:block">
      {/* Live status banner */}
      <StatusBanner busy={busy} dispatchStats={dispatchStats} hasReport={!!finalReport} status={status} />

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
              Description
            </SectionHeading>
            <p className="text-sm leading-relaxed text-white/75 md:text-[15px]">
              {busy
                ? 'Hermes Agent is analyzing the request and orchestrating the workflow...'
                : 'Workflow has not started. Send a prompt from the bottom bar to let Hermes begin orchestration.'}
            </p>
          </section>
        )}

        {/* How it works — compact action list derived from plan nodes */}
        {plan.length > 0 && (
          <section>
            <SectionHeading icon={<ListChecks className="h-3.5 w-3.5" />}>
              How it works
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

        {(plan.length > 0 || erc8183) && (
          <section>
            <SectionHeading icon={<Hexagon className="h-3.5 w-3.5" />}>
              ERC-8183 Trail
            </SectionHeading>
            <UnifiedTrail
              planCount={plan.length}
              dispatchStats={dispatchStats}
              dispatches={dispatches}
              hasReport={!!finalReport}
              status={status}
              erc8183={erc8183}
              reputationTx={reputationTx}
            />
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
              Report
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
            Hermes has not started orchestration. Send a message from the bottom bar to begin.
          </section>
        )}
      </div>
    </aside>
  )
}

type TrailState = 'idle' | 'active' | 'done' | 'failed'

function UnifiedTrail({
  planCount,
  dispatchStats,
  dispatches,
  hasReport,
  status,
  erc8183,
  reputationTx,
}: {
  planCount: number
  dispatchStats: { running: number; completed: number; failed: number; total: number }
  dispatches: Array<{
    planId: string
    label: string
    skill: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    tx: string | null
  }>
  hasReport: boolean
  status: string
  erc8183?: Erc8183Trail | null
  reputationTx: string | null
}) {
  const agentDone =
    dispatchStats.total > 0 &&
    dispatchStats.completed + dispatchStats.failed >= dispatchStats.total
  const agentState: TrailState = dispatchStats.failed > 0
    ? 'failed'
    : agentDone
      ? 'done'
      : dispatchStats.running > 0 || planCount > 0
        ? 'active'
        : 'idle'
  const reportState: TrailState = hasReport
    ? 'done'
    : agentDone || status === 'streaming' || status === 'submitted'
      ? 'active'
      : 'idle'
  const settleState: TrailState = erc8183?.completeTx
    ? 'done'
    : erc8183?.submitTx || (erc8183?.fundTx && hasReport)
      ? 'active'
      : 'idle'
  const reputationState: TrailState = reputationTx
    ? 'done'
    : erc8183?.completeTx
      ? 'active'
      : 'idle'

  return (
    <div className="space-y-3 border border-emerald-400/20 bg-black/20 p-3 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <TrailRow label="Plan" state={planCount > 0 ? 'done' : 'active'} detail={planCount ? `${planCount} steps` : 'planning'} />
        <TrailRow
          label="Agents"
          state={agentState}
          detail={`${dispatchStats.completed}/${dispatchStats.total || dispatches.length || 0} done`}
        />
        <TrailRow label="Report" state={reportState} detail={hasReport ? 'ready' : 'compose'} />
        <TrailRow label="Settle" state={settleState} detail={erc8183?.jobId ? `#${erc8183.jobId}` : 'pending'} />
        <TrailRow label="Reputation" state={reputationState} detail={reputationTx ? 'cached' : 'pending'} />
      </div>

      {dispatches.length > 0 && (
        <div className="space-y-1.5 border-t border-white/10 pt-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-white/45">Agent proofs</p>
          {dispatches.map((d) => (
            <TrailTxRow
              key={d.planId}
              label={d.label}
              detail={d.skill}
              tx={d.tx}
              state={d.status === 'completed' ? 'done' : d.status === 'failed' ? 'failed' : d.status === 'running' ? 'active' : 'idle'}
            />
          ))}
        </div>
      )}

      {erc8183 && (
        <div className="space-y-1.5 border-t border-white/10 pt-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-white/45">Settlement signatures</p>
          <MetaRow label="Job" value={erc8183.jobId ? `#${erc8183.jobId}` : 'pending'} />
          {erc8183.budgetUsdc && <MetaRow label="Budget" value={`${erc8183.budgetUsdc} USDC`} />}
          <TrailTxRow label="Create job" tx={erc8183.createTx} state={erc8183.jobId ? 'done' : erc8183.createTx ? 'active' : 'idle'} />
          <TrailTxRow label="Set budget" tx={erc8183.setBudgetTx} state={erc8183.setBudgetTx ? 'done' : erc8183.jobId ? 'active' : 'idle'} />
          <TrailTxRow label="Approve USDC" tx={erc8183.approveTx} state={erc8183.approveTx ? 'done' : erc8183.setBudgetTx ? 'active' : 'idle'} />
          <TrailTxRow label="Fund escrow" tx={erc8183.fundTx} state={erc8183.fundTx ? 'done' : erc8183.approveTx ? 'active' : 'idle'} />
          <TrailTxRow label="Submit deliverable" tx={erc8183.submitTx} state={erc8183.submitTx ? 'done' : hasReport && erc8183.fundTx ? 'active' : 'idle'} />
          <TrailTxRow label="Complete job" tx={erc8183.completeTx} state={erc8183.completeTx ? 'done' : erc8183.submitTx ? 'active' : 'idle'} />
          {erc8183.deliverableHash && <HashRow label="Deliverable" hash={erc8183.deliverableHash} />}
        </div>
      )}

      <div className="space-y-1.5 border-t border-white/10 pt-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-white/45">Reputation</p>
        <TrailTxRow label="Increment score" tx={reputationTx} state={reputationState} />
      </div>
    </div>
  )
}

function TrailRow({
  label,
  state,
  detail,
}: {
  label: string
  state: TrailState
  detail?: string
}) {
  return (
    <div className="flex items-center gap-2 border border-white/10 bg-black/15 px-2.5 py-2">
      <span
        className={`h-2 w-2 rounded-full ${
          state === 'done'
            ? 'bg-emerald-300'
            : state === 'active'
              ? 'animate-pulse bg-[var(--giga-accent)]'
              : state === 'failed'
                ? 'bg-red-300'
                : 'bg-white/20'
        }`}
      />
      <span
        className={
          state === 'done'
            ? 'text-white/85'
            : state === 'active'
              ? 'text-[var(--giga-accent)]'
              : state === 'failed'
                ? 'text-red-200'
                : 'text-white/45'
        }
      >
        {label}
      </span>
      {detail && <span className="ml-auto font-mono text-[10px] text-white/35">{detail}</span>}
    </div>
  )
}

function TrailTxRow({
  label,
  tx,
  detail,
  state,
}: {
  label: string
  tx?: string | null
  detail?: string
  state: TrailState
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          state === 'done'
            ? 'bg-emerald-300'
            : state === 'active'
              ? 'animate-pulse bg-[var(--giga-accent)]'
              : state === 'failed'
                ? 'bg-red-300'
                : 'bg-white/20'
        }`}
      />
      <span
        className={`min-w-0 flex-1 truncate ${
          state === 'done'
            ? 'text-white/75'
            : state === 'active'
              ? 'text-[var(--giga-accent)]'
              : state === 'failed'
                ? 'text-red-200'
                : 'text-white/35'
        }`}
      >
        {label}
        {detail && <span className="ml-1 font-mono text-[10px] text-purple-300/55">-&gt; {detail}</span>}
      </span>
      {tx && tx !== '0x0' ? (
        <a
          href={`${explorerBase()}/tx/${tx}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-cyan-300 hover:text-cyan-200 hover:underline"
        >
          {shortHash(tx)}
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : tx === '0x0' ? (
        <span className="shrink-0 font-mono text-[10px] text-white/35">allowance ok</span>
      ) : (
        <span className="shrink-0 font-mono text-[10px] text-white/25">pending</span>
      )}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-white/55">{label}</span>
      <span className="font-mono text-[10px] text-emerald-300">{value}</span>
    </div>
  )
}

function HashRow({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-white/55">{label}</span>
      <span className="shrink-0 font-mono text-[10px] text-emerald-300">{shortHash(hash)}</span>
    </div>
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
  status,
}: {
  busy: boolean
  dispatchStats: { running: number; completed: number; failed: number; total: number }
  hasReport: boolean
  status: string
}) {
  if (status === 'error') {
    return (
      <div className="mb-4 inline-flex items-center gap-2 border-2 border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        <span className="text-red-300">Hermes encountered an error</span>
      </div>
    )
  }
  if (!busy && !hasReport) return null
  if (hasReport && !busy) {
    return (
      <div className="mb-4 inline-flex items-center gap-2 border-2 border-[#3e6a62] bg-[#1f3632] px-3 py-1.5 text-xs">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="text-emerald-300">✓ Hermes orchestration complete</span>
      </div>
    )
  }
  if (busy) {
    return (
      <div className="mb-4 inline-flex items-center gap-2 border-2 border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 px-3 py-1.5 text-xs">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--giga-accent)]" />
        <span className="text-[var(--giga-accent)]">
          Hermes executing step {dispatchStats.completed + dispatchStats.failed + 1}
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
  let reputationTx: string | null = null
  const dispatches = new Map<
    string,
    { planId: string; label: string; skill: string; status: 'pending' | 'running' | 'completed' | 'failed'; tx: string | null }
  >()

  for (const m of messages) {
    for (const part of m.parts) {
      if (part.type === 'text' && m.role === 'assistant') {
        const text = 'text' in part ? part.text : ''
        if (isReportText(text)) {
          finalReport = (finalReport || '') + text
        }
      }

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
        const input = (part.input as { node_id?: string; skill_name?: string } | undefined) ?? {}
        const node = plan.find((p) => p.node_id === input.node_id)
        const key = node?.plan_id ?? input.node_id ?? `dispatch-${dispatches.size}`
        const current = dispatches.get(key) ?? {
          planId: key,
          label: node?.label ?? input.skill_name ?? 'Agent dispatch',
          skill: node?.skill_name ?? input.skill_name ?? 'unknown-skill',
          status: 'pending' as const,
          tx: null,
        }
        if (part.state === 'output-available') {
          const out = part.output as { ok?: boolean; dispatch_tx?: string | null } | undefined
          if (out?.ok === false) {
            failed++
            current.status = 'failed'
          } else {
            completed++
            current.status = 'completed'
          }
          current.tx = out?.dispatch_tx ?? current.tx
        } else if (part.state === 'input-streaming' || part.state === 'input-available') {
          running++
          current.status = 'running'
        }
        dispatches.set(key, current)
      }
      if (toolName === 'stream_error') {
        failed++
      }
      if (toolName === 'finalizeReport') {
        const output = (part.output || {}) as { ok?: boolean; summary_markdown?: string }
        if (part.state === 'output-available' && output.ok !== false && output.summary_markdown) {
          finalReport = output.summary_markdown
        }
      }
      if (toolName === 'reputationUpdate') {
        const output = (part.output || {}) as { tx?: string }
        reputationTx = output.tx ?? reputationTx
      }
    }
  }

  return {
    plan,
    finalReport,
    dispatchStats: { running, completed, failed, total },
    dispatches: [...dispatches.values()],
    reputationTx,
  }
}

function isReportText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('▸ Planning workflow')) return false
  if (trimmed.startsWith('Brain stopped before creating workflow nodes')) return false
  if (trimmed.startsWith('Workflow stopped before any agent node')) return false
  return true
}

function explorerBase() {
  return process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
}

function shortHash(hash: string) {
  return hash.length > 14 ? `${hash.slice(0, 8)}...${hash.slice(-4)}` : hash
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}
