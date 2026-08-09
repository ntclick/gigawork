'use client'

/**
 * WorkflowView — the run surface.
 *
 * The terminal is one panel here, not the whole screen: above it sit the
 * run status and the agent roster, below it the deliverable and the
 * on-chain payment trail. Navigation stays available in the header the
 * whole time.
 *
 * A planned workflow does NOT auto-execute — the backend waits for an
 * explicit dispatch. That's why the Run control is always visible while
 * nothing has started; without it the run just sat at "ready to execute"
 * while the planner's own text told the user to click a button that no
 * longer existed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, Play, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { LogLine } from '@/components/console/LogLine'
import { useStickToBottom } from '@/lib/hooks/useStickToBottom'
import { useWorkflowConsole } from '@/lib/hooks/useWorkflowConsole'
import type { ConsoleLine } from '@/lib/workflow/consoleLog'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

const STATUS_STYLE: Record<string, string> = {
  complete: 'text-[var(--gw-emerald)]',
  failed: 'text-[var(--gw-rose)]',
  running: 'text-[var(--gw-cyan)]',
  verifying: 'text-[var(--gw-cyan)]',
  hiring: 'text-[var(--gw-amber)]',
  planning: 'text-[var(--gw-amber)]',
  thinking: 'text-white/50',
  idle: 'text-white/35',
}

const STEP_ICON: Record<string, string> = {
  pending: '○',
  active: '◐',
  complete: '●',
  failed: '✕',
}

interface SkillMeta {
  slug: string
  reputation: number
  totalCalls: number
}

/**
 * One numbered stage of the payment trail. The three stages are always
 * rendered, greyed out until they actually happen, so the shape of the
 * flow is legible before any of it has run.
 */
function PayStep({
  n,
  label,
  sub,
  tx,
  done,
  children,
}: {
  n: number
  label: string
  sub: string
  tx?: string | null
  done: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex gap-3 px-3 py-2.5">
      <span
        className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
          done
            ? 'border-[var(--gw-emerald)]/50 bg-[var(--gw-emerald)]/10 text-[var(--gw-emerald)]'
            : 'border-white/12 text-white/25'
        }`}
      >
        {done ? '✓' : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className={done ? 'font-medium text-white/80' : 'text-white/40'}>{label}</span>
          {tx && (
            <a
              className="text-[var(--gw-cyan)] hover:underline"
              href={`${EXPLORER}/tx/${tx}`}
              target="_blank"
              rel="noreferrer"
            >
              ↗ {tx.slice(0, 10)}…
            </a>
          )}
        </div>
        <div className="mt-0.5 text-white/35">{sub}</div>
        {children}
      </div>
    </div>
  )
}

export function WorkflowView({ workflowId }: { workflowId: string }) {
  const { lines, status, viewState, push, refresh } = useWorkflowConsole(workflowId)
  const [busy, setBusy] = useState(false)
  const promptedRef = useRef(false)
  const dispatchingRef = useRef(false)

  const steps = useMemo(() => viewState?.steps ?? [], [viewState])
  const done = steps.filter((s) => s.status === 'complete').length
  const failed = steps.filter((s) => s.status === 'failed').length
  const notStarted = steps.length > 0 && steps.every((s) => s.status === 'pending')
  const settled = status === 'complete' || status === 'failed'
  const pct = steps.length ? Math.round(((done + failed) / steps.length) * 100) : 0

  const say = useCallback(
    (text: string, opts: Partial<Pick<ConsoleLine, 'tag' | 'severity'>> = {}) => {
      push({
        key: `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        tag: opts.tag ?? 'SYS',
        severity: opts.severity ?? 'info',
        text,
      })
    },
    [push],
  )

  const execute = useCallback(async () => {
    // `busy` is state, so two fast clicks both read the pre-update value and
    // both POST. A ref settles synchronously, so the second one is dropped.
    // Every dispatch pays the agents again, so this must not be racy.
    if (dispatchingRef.current) return
    dispatchingRef.current = true
    setBusy(true)
    try {
      say('dispatching the agent workforce…')
      const r = await fetch(`/api/workflow/${workflowId}/execute`, { method: 'POST' })
      if (r.ok) {
        say('workforce dispatched — agents are running', { severity: 'success' })
        refresh()
      } else {
        const t = await r.text().catch(() => '')
        say(`dispatch failed (${r.status}) ${t.slice(0, 160)}`, { tag: 'ERR', severity: 'error' })
      }
    } finally {
      dispatchingRef.current = false
      setBusy(false)
    }
  }, [workflowId, refresh, say])

  // `?run=1` means the user already confirmed the cost on the home page, so
  // the run carries straight through to a report. Waiting on `notStarted`
  // rather than firing on mount is deliberate: planning is asynchronous and
  // dispatching before the plan has nodes would execute an empty workflow.
  const autoRun = useSearchParams().get('run') === '1'

  useEffect(() => {
    if (promptedRef.current || !notStarted || settled) return
    promptedRef.current = true
    if (autoRun) {
      say('cost confirmed — dispatching automatically…')
      void execute()
      return
    }
    say('plan ready — nothing dispatched yet. press Run to start the workforce.', {
      severity: 'warn',
    })
  }, [notStarted, settled, autoRun, execute, say])

  // Dispatch is locked while the workforce is actually working. Without
  // this the button stayed live mid-run, and a second press queued another
  // pass over the same graph — paying every agent twice. It unlocks on its
  // own when the run settles, including when it fails, so a failed run can
  // still be retried.
  const inFlight = steps.some((s) => s.status === 'active')
  // Planning is now asynchronous — /api/workflow returns the id before the
  // plan exists so the user lands here immediately. Until nodes appear
  // there is nothing to dispatch, and pressing Run would execute an empty
  // graph.
  const planning = steps.length === 0
  const dispatchLocked = busy || inFlight || planning

  const report = lines.find((l) => l.block?.kind === 'report')?.block?.markdown ?? null
  const payments = lines.filter((l) => l.tag === 'x402')
  const spent = payments.reduce((sum, l) => {
    const m = l.text.match(/\$([\d.]+)/)
    return sum + (m ? parseFloat(m[1]) : 0)
  }, 0)

  const { ref, stuck, missed, onScroll, scrollToBottom } = useStickToBottom(lines.length)
  const visible = lines.length > 400 ? lines.slice(-400) : lines
  const erc = viewState?.erc8183

  // Reputation and lifetime call counts live on the skill registry, not on
  // the run, so they need their own fetch. Fetched once — these move on the
  // order of runs, not seconds, and re-polling them would just add noise.
  const [catalogue, setCatalogue] = useState<SkillMeta[]>([])
  useEffect(() => {
    let alive = true
    fetch('/api/skills')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return
        const rows = Array.isArray(j) ? j : (j.skills ?? [])
        setCatalogue(rows as SkillMeta[])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const skillBySlug = useMemo(
    () => new Map(catalogue.map((s) => [s.slug, s])),
    [catalogue],
  )

  // What each agent was actually paid on THIS run, read back off the settled
  // x402 lines ("settled $0.08 → defi-yields"). Deliberately not the skill's
  // current list price: prices change, and showing today's price next to an
  // older run would misreport what the user was charged.
  const paidBySlug = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of payments) {
      const hit = l.text.match(/\$([\d.]+)\s*→\s*(\S+)/)
      if (!hit) continue
      m.set(hit[2], (m.get(hit[2]) ?? 0) + parseFloat(hit[1]))
    }
    return m
  }, [payments])

  return (
    <main className="gwt-page">
      <div className="gwt-wrap">
        {/* ── Run status ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Workflow</div>
            <h1 className="mt-1 truncate text-[17px] font-semibold text-white/90">
              {viewState?.title ?? 'Loading…'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[12px] font-semibold ${STATUS_STYLE[status] ?? 'text-white/50'}`}>
              {status}
            </span>
            {/* Hidden only once the run has actually completed. A failed run
                keeps the control so it can be retried — the earlier
                `!settled` test hid it on failure too, leaving no way back. */}
            {status !== 'complete' && (
              <button
                className="gwt-btn"
                disabled={dispatchLocked}
                title={
                  planning
                    ? 'Hermes is still planning this run'
                    : inFlight
                      ? 'The workforce is running — wait for it to finish'
                      : undefined
                }
                onClick={execute}
              >
                {busy ? (
                  <>
                    <Loader2 size={13} className="gwt-spin" />
                    Dispatching…
                  </>
                ) : planning ? (
                  <>
                    <Loader2 size={13} className="gwt-spin" />
                    Planning…
                  </>
                ) : inFlight ? (
                  <>
                    <Loader2 size={13} className="gwt-spin" />
                    Running…
                  </>
                ) : status === 'failed' ? (
                  <>
                    <RotateCcw size={13} strokeWidth={2.5} />
                    Retry run
                  </>
                ) : notStarted ? (
                  <>
                    <Play size={13} strokeWidth={2.5} />
                    Run workforce
                  </>
                ) : (
                  <>
                    <Play size={13} strokeWidth={2.5} />
                    Re-dispatch
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {steps.length > 0 && (
          <div className="mt-3">
            <div className="gwt-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 text-[11px] text-white/35">
              <span>
                {done}/{steps.length} complete
              </span>
              {failed > 0 && <span className="text-[var(--gw-rose)]">{failed} failed</span>}
              {payments.length > 0 && (
                <span>
                  {payments.length} x402 payment{payments.length === 1 ? '' : 's'} · $
                  {spent.toFixed(2)} spent
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Deliverable, then the machinery that produced it ──
             The report used to sit below the log, the payment trail and
             the identity table — the one thing the user paid for was the
             last thing on the page. */}
        {steps.length > 0 && (
          <>
            <div className="gwt-h">Deliverable</div>
            <div className="gwt-panel gwt-deliver">
              <div className="gwt-panel-bar">
                <span>{report ? 'final report' : 'final report · pending'}</span>
                {report && (
                  <span className="flex gap-2">
                    <button
                      className="gwt-token"
                      onClick={() => navigator.clipboard.writeText(report)}
                    >
                      copy
                    </button>
                    <button
                      className="gwt-token"
                      onClick={() => {
                        const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `gigawork-${workflowId.slice(0, 8)}.md`
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                    >
                      save
                    </button>
                  </span>
                )}
              </div>

              {/* What was asked, and who answered it. Without this the report
                  opened straight into a verdict with no statement of the
                  task it was answering. */}
              <div className="gwt-brief">
                <div className="gwt-brief-k">Objective</div>
                <div className="gwt-brief-v">{viewState?.title ?? '—'}</div>
                <div className="gwt-brief-k">Produced by</div>
                <div className="gwt-brief-v">
                  {steps.length === 0
                    ? '—'
                    : steps
                        .map(
                          (s) =>
                            `${s.agentName}${s.status === 'failed' ? ' (failed)' : ''}`,
                        )
                        .join(' → ')}
                </div>
              </div>

              <div className="p-4">
                {report ? (
                  <div className="gwt-md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[12px] text-white/35">
                    {settled ? (
                      'This run finished without producing a report.'
                    ) : (
                      <>
                        <Loader2 size={13} className="gwt-spin" />
                        {inFlight
                          ? `Working — ${done + failed} of ${steps.length} agents done.`
                          : 'The report appears here once the workforce finishes.'}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="gwt-h">Hired workforce</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {steps.map((s) => (
                <div key={s.id} className={`gwt-agent gwt-agent-${s.status}`}>
                  <span
                    className={
                      s.status === 'complete'
                        ? 'text-[var(--gw-emerald)]'
                        : s.status === 'failed'
                          ? 'text-[var(--gw-rose)]'
                          : s.status === 'active'
                            ? 'text-[var(--gw-cyan)]'
                            : 'text-white/25'
                    }
                  >
                    {STEP_ICON[s.status] ?? '○'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-white/85">{s.agentName}</span>
                    <span className="block truncate text-[11px] text-white/35">
                      {s.errorMessage ?? s.outputSummary ?? s.label}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[10.5px] text-white/30">
                    {s.agentTokenId && <span className="block">#{s.agentTokenId}</span>}
                    {s.pricePerCall && <span className="block">${s.pricePerCall}</span>}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Terminal ─────────────────────────────────────────── */}
        <div className="gwt-h">Execution log</div>
        <div className="gwt-panel overflow-hidden">
          <div className="gwt-panel-bar">
            <span>protocol telemetry</span>
            <span className="normal-case tracking-normal text-white/25">
              {lines.length} lines
              {!stuck && missed > 0 && (
                <button className="gwt-token ml-2" onClick={scrollToBottom}>
                  {missed} new ↓
                </button>
              )}
            </span>
          </div>
          <div ref={ref} onScroll={onScroll} className="gwt-term">
            {visible.length === 0 ? (
              <div className="gwt-muted">no telemetry yet…</div>
            ) : (
              <ol>
                {visible
                  .filter((l) => !l.block)
                  .map((l) => (
                    <LogLine key={l.key} line={l} />
                  ))}
              </ol>
            )}
          </div>
        </div>

        {/* ── How this run was paid for ────────────────────────── */}
        {(erc?.jobId || payments.length > 0) && (
          <>
            <div className="gwt-h">How this run was paid for</div>
            <div className="gwt-panel divide-y divide-white/6 text-[12px]">
              <PayStep
                n={1}
                label="Escrow opened"
                sub={
                  erc?.jobId
                    ? `ERC-8183 job #${erc.jobId} — $${erc.budgetUsdc ?? '0.00'} locked from your vault as the job budget`
                    : 'not opened'
                }
                tx={erc?.fundTx}
                done={!!erc?.fundTx}
              />
              <PayStep
                n={2}
                label={`Agents paid per call — ${payments.length} × x402`}
                sub={
                  payments.length
                    ? `$${spent.toFixed(2)} transferred straight from your vault to each agent as it delivered. Failed agents are not charged.`
                    : 'no agent has been paid yet'
                }
                done={payments.length > 0}
              >
                {payments.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {payments.map((p) => (
                      <li key={p.key} className="flex items-baseline gap-2 text-white/45">
                        <span className="text-[var(--gw-emerald)]">•</span>
                        <span className="min-w-0 flex-1 truncate">{p.text}</span>
                        {p.txHash && (
                          <a
                            className="shrink-0 text-[var(--gw-cyan)] hover:underline"
                            href={`${EXPLORER}/tx/${p.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            ↗ {p.txHash.slice(0, 10)}…
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </PayStep>
              <PayStep
                n={3}
                label="Escrow settled"
                sub={
                  erc?.completeTx
                    ? 'Deliverable submitted on-chain and the escrow released.'
                    : 'released once the deliverable is submitted'
                }
                tx={erc?.completeTx}
                done={!!erc?.completeTx}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span className="text-white/40">Total charged to your vault</span>
                <span className="font-semibold text-[var(--gw-cyan)]">
                  ${(spent + parseFloat(erc?.budgetUsdc ?? '0')).toFixed(2)} USDC
                  <span className="ml-2 font-normal text-white/30">
                    (${erc?.budgetUsdc ?? '0.00'} escrow + ${spent.toFixed(2)} agents)
                  </span>
                </span>
              </div>
            </div>
          </>
        )}

        {/* ── ERC-8004 identity & reputation ───────────────────── */}
        {steps.length > 0 && (
          <>
            <div className="gwt-h">ERC-8004 identity &amp; reputation</div>
            <div className="gwt-panel p-3 text-[12px]">
              <div className="mb-2.5 text-white/40">
                Both sides of the hire are ERC-8004 agents. The client below hired the providers,
                and when the run settles the Reputation Registry is incremented for every one of
                them — the client included, since paying and specifying work well is its own track
                record.
              </div>

              {/* The hiring agent. Naming it is the point: without this the
                  table read as a list of providers with no stated buyer. */}
              <div className="gwt-client">
                <span className="gwt-client-k">Client agent</span>
                <span className="gwt-client-v">
                  {viewState?.client?.identityTokenId ? (
                    <>
                      ERC-8004{' '}
                      <span className="text-[var(--gw-cyan)]">
                        #{viewState.client.identityTokenId}
                      </span>{' '}
                      <span className="text-white/30">
                        · reputation {viewState.client.reputationScore ?? '—'}
                      </span>
                    </>
                  ) : (
                    <span className="text-white/35">
                      no identity minted — this run was hired anonymously
                    </span>
                  )}
                </span>
                <span className="gwt-client-k">Hired</span>
                <span className="gwt-client-v">
                  {steps.length} provider agent{steps.length === 1 ? '' : 's'}, listed below
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="gwt-list">
                  <thead>
                    <tr>
                      <th>Provider agent</th>
                      <th>Identity</th>
                      <th className="text-right">Reputation</th>
                      <th className="text-right">Calls</th>
                      <th className="text-right">Paid this run</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {steps.map((s) => {
                      const meta = s.agentSlug ? skillBySlug.get(s.agentSlug) : undefined
                      return (
                        <tr key={s.id}>
                          <td className="text-white/75">{s.agentName}</td>
                          <td className="text-white/40">
                            {s.agentTokenId ? `#${s.agentTokenId}` : 'not minted'}
                          </td>
                          <td className="text-right text-white/60">
                            {meta ? meta.reputation : '—'}
                          </td>
                          <td className="text-right text-white/30">{meta?.totalCalls ?? '—'}</td>
                          <td className="text-right text-white/60">
                            {(() => {
                              const paid = s.agentSlug ? paidBySlug.get(s.agentSlug) : undefined
                              if (paid !== undefined) return `$${paid.toFixed(2)}`
                              return s.pricePerCall ? `$${s.pricePerCall}` : '—'
                            })()}
                          </td>
                          <td
                            className={
                              s.status === 'complete'
                                ? 'text-[var(--gw-emerald)]'
                                : s.status === 'failed'
                                  ? 'text-[var(--gw-rose)]'
                                  : 'text-white/35'
                            }
                          >
                            {s.status}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2.5 text-white/35">
                {erc?.reputationTx ? (
                  <a
                    className="text-[var(--gw-cyan)] hover:underline"
                    href={`${EXPLORER}/tx/${erc.reputationTx}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ↗ Reputation scored on-chain for all{' '}
                    {steps.length + (viewState?.client?.identityTokenId ? 1 : 0)} agents in this run
                    — {steps.length} provider
                    {steps.length === 1 ? '' : 's'}
                    {viewState?.client?.identityTokenId ? ' and the client' : ''}
                  </a>
                ) : settled ? (
                  'Reputation feedback for this run has not been written on-chain yet.'
                ) : (
                  'Reputation is scored for the client and every provider once the run settles.'
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Deliverable ──────────────────────────────────────── */}
      </div>
    </main>
  )
}
