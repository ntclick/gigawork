'use client'

/**
 * useWorkflowConsole — all data orchestration for the terminal.
 *
 * Owns the polling of the three real sources and merges them through the
 * pure builder in lib/workflow/consoleLog.ts. Everything it consumes
 * already exists server-side; this hook adds no backend surface.
 *
 *   view-state   → the classified event timeline (the spine of the log)
 *   nanopayments → real on-chain x402 settlements with tx hashes
 *   messages     → planner narration + the final deliverable
 *
 * Polling stops once the run reaches a terminal state, so a completed
 * workflow left open in a tab doesn't hammer the API forever.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  buildConsoleLines,
  type ConsoleLine,
  type ConsoleMessageInput,
  type ConsoleNanopaymentInput,
} from '@/lib/workflow/consoleLog'
import { extractReportMarkdown } from '@/lib/workflow/reportText'
import type { WorkflowViewState } from '@/types/workflow-view'

const TERMINAL_STATUSES = new Set(['complete', 'failed'])

interface RawMessage {
  id: string
  role: string
  createdAt?: string
  content?: unknown
  parts?: unknown[]
}

/** One trimmed line's worth of text for a tool artifact. */
function toolSummary(p: Record<string, unknown>): string {
  const name = String(p.type ?? '').replace(/^tool-/, '')
  const out = (p.output ?? {}) as Record<string, unknown>
  if (name === 'stream_error') return `stream error: ${String(out.error ?? '')}`
  if (name === 'dispatchSkill') {
    const skill = String(out.skill_name ?? 'skill')
    return out.ok === false ? `${skill} failed: ${String(out.error ?? '')}` : `${skill} dispatched`
  }
  return name
}

/**
 * Explode a message into one console-bound artifact per part, each with
 * its own persisted timestamp. The API bundles every assistant artifact
 * into a single message; rendering that as one line produced an
 * unreadable wall of text.
 */
function explode(m: RawMessage): { id: string; role: string; text: string; ts?: number }[] {
  const parseAt = (v: unknown) => {
    if (typeof v !== 'string') return undefined
    const t = Date.parse(v)
    return Number.isNaN(t) ? undefined : t
  }
  const msgTs = parseAt(m.createdAt)

  if (typeof m.content === 'string' && m.content.trim()) {
    return [{ id: m.id, role: m.role, text: m.content.trim(), ts: msgTs }]
  }
  if (!Array.isArray(m.parts)) return []

  const out: { id: string; role: string; text: string; ts?: number }[] = []
  m.parts.forEach((raw, i) => {
    const p = raw as Record<string, unknown>
    if (!p || typeof p !== 'object') return
    const ts = parseAt(p.createdAt) ?? msgTs
    if (p.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
      out.push({ id: `${m.id}:${i}`, role: m.role, text: p.text.trim(), ts })
    } else if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
      const text = toolSummary(p)
      if (text) out.push({ id: `${m.id}:${i}`, role: m.role, text, ts })
    }
  })
  return out
}

export interface UseWorkflowConsole {
  lines: ConsoleLine[]
  status: WorkflowViewState['overallStatus'] | 'idle'
  running: boolean
  /** Raw read model — the console uses it to detect "planned, not yet run". */
  viewState: WorkflowViewState | null
  /** Append a client-originated line (command echo, error, progress). */
  push: (line: Omit<ConsoleLine, 'seq' | 'ts'> & { ts?: number }) => void
  /** Wipe local lines only — server-derived lines rebuild from the API. */
  clearLocal: () => void
  refresh: () => void
}

export function useWorkflowConsole(workflowId: string | null): UseWorkflowConsole {
  const [viewState, setViewState] = useState<WorkflowViewState | null>(null)
  const [nanopayments, setNanopayments] = useState<ConsoleNanopaymentInput[]>([])
  const [messages, setMessages] = useState<ConsoleMessageInput[]>([])
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(null)
  const [local, setLocal] = useState<ConsoleLine[]>([])
  const [tick, setTick] = useState(0)

  // messageId → first-seen epoch ms. Chat messages carry no server
  // timestamp; anchoring them once keeps a streaming line from jumping
  // around in the ordering as its text grows.
  const anchorsRef = useRef<Record<string, number>>({})

  const status = viewState?.overallStatus ?? 'idle'
  const running = !!workflowId && !TERMINAL_STATUSES.has(status)

  const push = useCallback((line: Omit<ConsoleLine, 'seq' | 'ts'> & { ts?: number }) => {
    setLocal((prev) => [
      ...prev,
      { ...line, ts: line.ts ?? Date.now(), seq: 1 } as ConsoleLine,
    ])
  }, [])

  const clearLocal = useCallback(() => setLocal([]), [])
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  // ── view-state ────────────────────────────────────────────────────
  useEffect(() => {
    if (!workflowId) {
      setViewState(null)
      return
    }
    let cancelled = false

    const load = async () => {
      try {
        const r = await fetch(`/api/workflows/${workflowId}/view-state`, { cache: 'no-store' })
        if (!r.ok || cancelled) return
        const j = (await r.json()) as WorkflowViewState
        if (!cancelled) setViewState(j)
      } catch {
        /* transient — the next tick retries */
      }
    }

    load()
    if (TERMINAL_STATUSES.has(status)) return
    const t = setInterval(load, 2500)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [workflowId, status, tick])

  // ── nanopayments ──────────────────────────────────────────────────
  useEffect(() => {
    if (!workflowId) {
      setNanopayments([])
      return
    }
    let cancelled = false

    const load = async () => {
      try {
        const r = await fetch(`/api/workflow/${workflowId}/nanopayments`, { cache: 'no-store' })
        if (!r.ok || cancelled) return
        const j = await r.json()
        if (!cancelled) setNanopayments(j.events ?? [])
      } catch {
        /* transient */
      }
    }

    load()
    if (TERMINAL_STATUSES.has(status)) return
    const t = setInterval(load, 2500)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [workflowId, status, tick])

  // ── messages + report ─────────────────────────────────────────────
  useEffect(() => {
    if (!workflowId) {
      setMessages([])
      setReportMarkdown(null)
      return
    }
    let cancelled = false

    const load = async () => {
      try {
        const r = await fetch(`/api/workflow/${workflowId}/messages`, { cache: 'no-store' })
        if (!r.ok || cancelled) return
        const j = await r.json()
        const raw = (j.messages ?? []) as RawMessage[]

        const now = Date.now()
        const mapped: ConsoleMessageInput[] = []
        for (const m of raw) {
          for (const part of explode(m)) {
            // Only anchor artifacts the server couldn't timestamp (live
            // stream fragments). Persisted ones keep their real time.
            if (part.ts === undefined && anchorsRef.current[part.id] === undefined) {
              anchorsRef.current[part.id] = now
            }
            mapped.push({
              id: part.id,
              role: part.role,
              text: part.text,
              ts: part.ts,
              anchorId: part.id,
            })
          }
        }
        if (cancelled) return
        setMessages(mapped)
        setReportMarkdown(extractReportMarkdown(j.messages))
      } catch {
        /* transient */
      }
    }

    load()
    if (TERMINAL_STATUSES.has(status)) return
    const t = setInterval(load, 3000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [workflowId, status, tick])

  const lines = useMemo(
    () =>
      buildConsoleLines({
        viewState,
        nanopayments,
        messages,
        messageAnchors: anchorsRef.current,
        local,
        reportMarkdown,
      }),
    [viewState, nanopayments, messages, local, reportMarkdown],
  )

  return { lines, status, running, viewState, push, clearLocal, refresh }
}
