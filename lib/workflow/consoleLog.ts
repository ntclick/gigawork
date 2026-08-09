/**
 * lib/workflow/consoleLog.ts
 *
 * Builds the terminal console's log stream. Pure function of serializable
 * inputs — no fetching, no clocks, no side effects.
 *
 * This replaces the old "Protocol Telemetry Logs" builder that lived
 * inside FocusedStepList, which fabricated its own timestamps with
 * `new Date()` at render time. Because that ran inside a `useMemo` that
 * recomputed on every 2.5s poll, the timeline visibly re-stamped and
 * re-ordered itself while you watched it. It also invented lines (a
 * hardcoded registry address, a default "$0.08" price) when real data was
 * missing.
 *
 * HARD RULE: this module never calls `Date.now()` or `new Date()` with no
 * argument. Every `ts` traces back to a persisted field. If a source
 * genuinely has no timestamp, the caller supplies an anchor (see
 * `messageAnchors`) — we never guess.
 *
 * The real timeline already exists server-side: `WorkflowViewState.events`
 * is built by lib/workflow/view-state.ts, which assigns every event a
 * phase, severity, title and timestamp. This module maps that (plus
 * on-chain nanopayments and brain messages) into flat console lines.
 */
import type { WorkflowViewState } from '@/types/workflow-view'

export type ConsoleTag =
  | 'YOU'
  | 'SYS'
  | 'PLAN'
  | 'AGENT'
  | 'x402'
  | 'ERC-8183'
  | 'ERC-8004'
  | 'DATA'
  | 'ERR'

export type ConsoleSeverity = 'info' | 'success' | 'warn' | 'error' | 'muted'

export interface ConsoleLine {
  /** Stable dedupe id — never an array index. */
  key: string
  /** Epoch ms, from a persisted field only. */
  ts: number
  /** Deterministic tie-break for lines sharing a millisecond. */
  seq: number
  tag: ConsoleTag
  severity: ConsoleSeverity
  text: string
  /** Rendered as an indented continuation line. */
  detail?: string
  /** Rendered as a right-aligned explorer link. */
  txHash?: string | null
  /** Renders a trailing blinking caret (work still in flight). */
  pending?: boolean
  /**
   * Clickable action appended to the line. Client-originated lines only —
   * the pure builder never emits one. The console maps `id` to a handler.
   */
  action?: { id: string; label: string }
  /** Full-width block, e.g. the final markdown deliverable. */
  block?: { kind: 'report'; markdown: string }
}

/**
 * One console-bound artifact from the message log. `ts` is the real
 * persisted row timestamp (`/api/workflow/[id]/messages` returns
 * `createdAt` per part); `anchorId` is only used for live streaming
 * parts that don't have one yet.
 */
export interface ConsoleMessageInput {
  id: string
  role: string
  text: string
  ts?: number
  anchorId?: string
  pending?: boolean
}

export interface ConsoleNanopaymentInput {
  id: string
  skillName: string
  amountUsdc: string
  status: string
  txHash?: string | null
  createdAt: string
}

export interface ConsoleLogInput {
  viewState?: WorkflowViewState | null
  nanopayments?: ConsoleNanopaymentInput[]
  messages?: ConsoleMessageInput[]
  /**
   * messageId → epoch ms of when the client first saw it. Chat messages
   * carry no server timestamp, so the console records one on first sight
   * and never rewrites it — that is what stops a streaming line from
   * jumping around in the ordering while its text grows.
   */
  messageAnchors?: Record<string, number>
  /** Client-originated lines: command echoes, 402/403, topup progress. */
  local?: ConsoleLine[]
  /** Final deliverable markdown, if the run produced one. */
  reportMarkdown?: string | null
}

/** Rank for lines sharing a timestamp, so the sort is total and stable. */
const TAG_SEQ: Record<ConsoleTag, number> = {
  YOU: 0,
  SYS: 1,
  PLAN: 2,
  'ERC-8004': 3,
  'ERC-8183': 4,
  AGENT: 5,
  x402: 6,
  DATA: 7,
  ERR: 8,
}

const PHASE_TAG: Record<string, ConsoleTag> = {
  create: 'SYS',
  planning: 'PLAN',
  dispatch: 'AGENT',
  payment: 'x402',
  settlement: 'ERC-8183',
  finalize: 'SYS',
}

function severityOf(s: string | undefined): ConsoleSeverity {
  if (s === 'success') return 'success'
  if (s === 'warning') return 'warn'
  if (s === 'error') return 'error'
  return 'info'
}

function parseTs(value: string | null | undefined): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : t
}

function line(l: Omit<ConsoleLine, 'seq'>): ConsoleLine {
  return { ...l, seq: TAG_SEQ[l.tag] }
}

/**
 * Merge every source into one ascending, de-duplicated console stream.
 */
export function buildConsoleLines(input: ConsoleLogInput): ConsoleLine[] {
  const { viewState, nanopayments = [], messages = [], messageAnchors = {}, local = [], reportMarkdown } = input

  const out: ConsoleLine[] = []

  // ── 1. Server timeline ────────────────────────────────────────────
  // Already classified by lib/workflow/view-state.ts — we only reshape.
  const events = viewState?.events ?? []
  // Payments that the timeline already reports, so the nanopayment table
  // doesn't print them a second time.
  const paymentIdsInTimeline = new Set(
    events.map((e) => e.paymentId).filter((x): x is string => !!x),
  )
  // node.completed / node.failed events we can hang step detail off.
  const eventByNode = new Map<string, ConsoleLine>()

  for (const e of events) {
    const ts = parseTs(e.timestamp)
    if (ts === null) continue // never invent a timestamp
    const tag: ConsoleTag = e.type?.startsWith('erc8004.')
      ? 'ERC-8004'
      : PHASE_TAG[e.phase] ?? 'SYS'
    const l = line({
      key: `ev:${e.id}`,
      ts,
      tag,
      severity: severityOf(e.severity),
      text: e.title,
      detail: e.message ?? undefined,
      txHash: e.txHash ?? null,
    })
    out.push(l)
    if (e.nodeId && (e.type === 'node.completed' || e.type === 'node.failed')) {
      eventByNode.set(e.nodeId, l)
    }
  }

  // ── 2. Steps ──────────────────────────────────────────────────────
  // Output summaries / errors attach to the matching node event when one
  // exists, and stand alone only when the events table lagged the nodes
  // table — so nothing is printed twice.
  for (const s of viewState?.steps ?? []) {
    const startedAt = parseTs(s.startedAt)
    const completedAt = parseTs(s.completedAt)

    if (s.status === 'active' && startedAt !== null) {
      const price = s.pricePerCall ? ` · $${s.pricePerCall}` : ''
      const id = s.agentTokenId ? ` #${s.agentTokenId}` : ''
      out.push(
        line({
          key: `st:${s.id}:run`,
          ts: startedAt,
          tag: 'AGENT',
          severity: 'info',
          text: `${s.agentName}${id} running — ${s.label}${price}`,
          pending: true,
        }),
      )
    }

    if (s.outputSummary && s.status === 'complete') {
      const attached = eventByNode.get(s.id)
      if (attached) {
        attached.detail = attached.detail ?? s.outputSummary
      } else if (completedAt !== null) {
        out.push(
          line({
            key: `st:${s.id}:out`,
            ts: completedAt,
            tag: 'DATA',
            severity: 'muted',
            text: `${s.agentName}: ${s.outputSummary}`,
          }),
        )
      }
    }

    if (s.errorMessage && s.status === 'failed') {
      const attached = eventByNode.get(s.id)
      const ts = completedAt ?? startedAt
      if (attached) {
        attached.detail = attached.detail ?? s.errorMessage
      } else if (ts !== null) {
        out.push(
          line({
            key: `st:${s.id}:err`,
            ts,
            tag: 'ERR',
            severity: 'error',
            text: `${s.agentName} failed: ${s.errorMessage}`,
          }),
        )
      }
    }
  }

  // ── 3. On-chain x402 settlements ──────────────────────────────────
  for (const p of nanopayments) {
    if (paymentIdsInTimeline.has(p.id)) continue
    const ts = parseTs(p.createdAt)
    if (ts === null) continue
    const settled = p.status === 'settled'
    out.push(
      line({
        key: `pay:${p.id}`,
        ts,
        tag: 'x402',
        severity: settled ? 'success' : p.status === 'failed' ? 'error' : 'info',
        text: `${settled ? 'settled' : p.status} $${p.amountUsdc} → ${p.skillName}`,
        txHash: p.txHash ?? null,
      }),
    )
  }

  // ── 4. Chat messages ──────────────────────────────────────────────
  // Real `ts` wins. The anchor fallback exists only for live streaming
  // parts that haven't been persisted yet — we never stamp a historical
  // line with "now", which would sink a replayed run's prompt to the
  // bottom of its own log.
  for (const m of messages) {
    const ts = typeof m.ts === 'number' ? m.ts : messageAnchors[m.anchorId ?? m.id]
    if (typeof ts !== 'number') continue
    if (!m.text.trim()) continue
    out.push(
      line({
        key: `msg:${m.id}`,
        ts,
        tag: m.role === 'user' ? 'YOU' : 'PLAN',
        severity: 'info',
        text: m.text,
        pending: m.pending,
      }),
    )
  }

  // ── 5. Client-originated lines ────────────────────────────────────
  for (const l of local) out.push(l)

  // ── 6. Final deliverable ──────────────────────────────────────────
  if (reportMarkdown) {
    const last = out.reduce((max, l) => (l.ts > max ? l.ts : max), 0)
    const ts = parseTs(viewState?.completedAt) ?? last
    out.push(
      line({
        key: 'report',
        ts,
        tag: 'SYS',
        severity: 'success',
        text: 'deliverable ready',
        block: { kind: 'report', markdown: reportMarkdown },
      }),
    )
  }

  // ── 7. Dedupe (last writer wins) then total-order sort ────────────
  const byKey = new Map<string, ConsoleLine>()
  for (const l of out) byKey.set(l.key, l)

  return [...byKey.values()].sort(
    (a, b) => a.ts - b.ts || a.seq - b.seq || a.key.localeCompare(b.key),
  )
}

/** `HH:MM:SS`, 24h, locale-stable. */
export function formatConsoleTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
