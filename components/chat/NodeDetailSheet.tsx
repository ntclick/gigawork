'use client'

/**
 * NodeDetailSheet — bottom-slide pixel panel showing one workflow node's
 * input/output JSON + ERC-8183 dispatch tx + agent link.
 *
 * Mounted in WorkflowCanvas via state. Closes on backdrop click or X.
 */
import Link from 'next/link'
import { ChevronDown, ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

export interface NodeDetail {
  id: string
  label: string
  skill: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  input?: unknown
  output?: unknown
  dispatchTx?: string | null
  startedAt?: number | null
  finishedAt?: number | null
}

export function NodeDetailSheet({
  detail,
  onClose,
}: {
  detail: NodeDetail | null
  onClose: () => void
}) {
  if (!detail) return null
  return <NodeDetailSheetInner detail={detail} onClose={onClose} />
}

function NodeDetailSheetInner({
  detail,
  onClose,
}: {
  detail: NodeDetail
  onClose: () => void
}) {
  const [showInput, setShowInput] = useState(false)
  const [showOutput, setShowOutput] = useState(true)

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const latency =
    detail.startedAt && detail.finishedAt
      ? ((detail.finishedAt - detail.startedAt) / 1000).toFixed(1) + 's'
      : null

  const statusColor: Record<typeof detail.status, string> = {
    pending: 'border-white/30 bg-white/5 text-white/55',
    running: 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200',
    completed: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200',
    failed: 'border-red-400/50 bg-red-500/15 text-red-200',
  }

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] overflow-y-auto border-t-2 border-black bg-[var(--giga-panel)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle bar */}
        <div className="flex items-center justify-between border-b-2 border-black bg-[var(--giga-sidebar)] px-4 py-2">
          <div className="min-w-0 flex-1 truncate">
            <div className="text-[10px] uppercase tracking-wider text-white/55">
              Node {detail.id.slice(0, 8)}
            </div>
            <div className="truncate font-pixel-header text-sm text-white">
              {detail.label}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-3 inline-flex h-8 w-8 items-center justify-center text-white/55 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          {/* Status row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`border-2 px-2 py-0.5 text-[11px] uppercase tracking-wider ${statusColor[detail.status]}`}>
              {detail.status}
            </span>
            <Link
              href={`/agents/${detail.skill}`}
              className="border-2 border-black bg-[var(--giga-accent)] px-2 py-0.5 text-[11px] font-bold text-black hover:bg-yellow-300"
            >
              {detail.skill} →
            </Link>
            {latency && (
              <span className="text-[11px] text-white/55">latency {latency}</span>
            )}
            {detail.dispatchTx && (
              <a
                href={`${EXPLORER}/tx/${detail.dispatchTx}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 border-2 border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
              >
                ERC-8183 tx <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Input */}
          {detail.input !== undefined && (
            <CollapsibleJson
              label="Input"
              value={detail.input}
              expanded={showInput}
              onToggle={() => setShowInput((v) => !v)}
            />
          )}

          {/* Output */}
          {detail.output !== undefined && (
            <CollapsibleJson
              label={detail.status === 'failed' ? 'Error' : 'Output'}
              value={detail.output}
              expanded={showOutput}
              onToggle={() => setShowOutput((v) => !v)}
              tone={detail.status === 'failed' ? 'error' : undefined}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function CollapsibleJson({
  label,
  value,
  expanded,
  onToggle,
  tone,
}: {
  label: string
  value: unknown
  expanded: boolean
  onToggle: () => void
  tone?: 'error'
}) {
  let formatted: string
  try {
    formatted = JSON.stringify(value, null, 2)
  } catch {
    formatted = String(value)
  }
  const lines = formatted.split('\n').length
  return (
    <div className="border-2 border-black bg-[var(--giga-dark)]">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-[var(--giga-sidebar)] px-3 py-2 text-left text-[11px] uppercase tracking-wider text-white/65 hover:text-white"
      >
        <span className={tone === 'error' ? 'text-red-300' : ''}>{label}</span>
        <span className="flex items-center gap-1 text-[10px] text-white/45">
          {lines} lines
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {expanded && (
        <pre className="max-h-[40vh] overflow-auto p-3 font-mono text-[11px] leading-relaxed text-white/85">
          {formatted}
        </pre>
      )}
    </div>
  )
}
