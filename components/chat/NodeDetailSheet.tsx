'use client'

/**
 * NodeDetailSheet — bottom-slide pixel panel showing one workflow node's
 * input/output JSON + ERC-8183 dispatch tx + agent link, plus an inline
 * edit form so the user can swap the provider, tweak inputs, and re-run
 * just that step (Minara-style "Yêu cầu chỉnh sửa").
 */
import Link from 'next/link'
import { ChevronDown, ExternalLink, Pencil, RotateCw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useSkills } from '@/lib/hooks/useSkills'

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

export interface NodeEditRequest {
  nodeId: string
  originalSkill: string
  newSkill: string
  inputJson: string
  note: string
}

export function NodeDetailSheet({
  detail,
  onClose,
  onEdit,
}: {
  detail: NodeDetail | null
  onClose: () => void
  onEdit?: (req: NodeEditRequest) => void
}) {
  if (!detail) return null
  return <NodeDetailSheetInner detail={detail} onClose={onClose} onEdit={onEdit} />
}

function NodeDetailSheetInner({
  detail,
  onClose,
  onEdit,
}: {
  detail: NodeDetail
  onClose: () => void
  onEdit?: (req: NodeEditRequest) => void
}) {
  const [showInput, setShowInput] = useState(false)
  const [showOutput, setShowOutput] = useState(true)
  const [editing, setEditing] = useState(false)
  const { skills } = useSkills()
  const [draftSkill, setDraftSkill] = useState(detail.skill)
  const initialInputJson = useMemo(() => {
    try {
      return detail.input !== undefined ? JSON.stringify(detail.input, null, 2) : '{}'
    } catch {
      return '{}'
    }
  }, [detail.input])
  const [draftInput, setDraftInput] = useState(initialInputJson)
  const [draftNote, setDraftNote] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

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

          {/* Edit toggle — surfaces the inline form so users can swap the
              provider or tweak inputs without leaving the canvas. */}
          {onEdit && !editing && (
            <button
              onClick={() => {
                setEditing(true)
                setDraftSkill(detail.skill)
                setDraftInput(initialInputJson)
                setDraftNote('')
                setEditError(null)
              }}
              className="inline-flex items-center gap-1.5 border-2 border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 px-3 py-1.5 text-xs font-bold text-[var(--giga-accent)] transition hover:bg-[var(--giga-accent)]/20"
            >
              <Pencil className="h-3 w-3" />
              Yêu cầu chỉnh sửa
            </button>
          )}

          {/* Inline edit form */}
          {onEdit && editing && (
            <div className="space-y-3 border-2 border-[var(--giga-accent)] bg-[var(--giga-accent)]/[0.04] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--giga-accent)]">
                  Edit step · {detail.label}
                </span>
                <button
                  onClick={() => setEditing(false)}
                  className="text-white/45 hover:text-white"
                  aria-label="Cancel edit"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/55">
                  Provider (skill)
                </label>
                <select
                  value={draftSkill}
                  onChange={(e) => setDraftSkill(e.target.value)}
                  className="w-full border-2 border-black bg-[#1f1f33] px-3 py-2 text-sm text-white focus:border-[var(--giga-accent)] focus:outline-none"
                >
                  {skills.length === 0 ? (
                    <option value={detail.skill}>{detail.skill}</option>
                  ) : (
                    skills.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.manifest.display_name ?? s.name} — {s.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/55">
                  Input JSON
                </label>
                <textarea
                  value={draftInput}
                  onChange={(e) => setDraftInput(e.target.value)}
                  rows={6}
                  className="w-full resize-y border-2 border-black bg-[#1f1f33] px-3 py-2 font-mono text-[11px] text-white placeholder:text-white/30 focus:border-[var(--giga-accent)] focus:outline-none"
                  spellCheck={false}
                />
              </div>

              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/55">
                  Ghi chú cho brain <span className="text-white/35">(optional)</span>
                </label>
                <textarea
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  placeholder="e.g., dùng chain Solana thay vì Ethereum, hoặc lấy thêm 24h volume"
                  rows={2}
                  className="w-full resize-none border-2 border-black bg-[#1f1f33] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[var(--giga-accent)] focus:outline-none"
                />
              </div>

              {editError && (
                <div className="border-2 border-red-400/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
                  {editError}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(false)}
                  className="border-2 border-black bg-[#1f1f33] px-3 py-1.5 text-xs text-white/75 hover:bg-[#27273f]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    let parsedJson = draftInput.trim()
                    if (parsedJson) {
                      try {
                        // Validate but resend the user's formatting verbatim so
                        // their key order / comments survive the round-trip.
                        JSON.parse(parsedJson)
                      } catch (e) {
                        setEditError(
                          'Input JSON invalid: ' + (e instanceof Error ? e.message : 'parse error'),
                        )
                        return
                      }
                    } else {
                      parsedJson = '{}'
                    }
                    setEditError(null)
                    onEdit({
                      nodeId: detail.id,
                      originalSkill: detail.skill,
                      newSkill: draftSkill || detail.skill,
                      inputJson: parsedJson,
                      note: draftNote.trim(),
                    })
                    setEditing(false)
                    onClose()
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 border-2 border-black bg-[var(--giga-accent)] px-3 py-1.5 text-xs font-bold text-black hover:bg-yellow-300"
                >
                  <RotateCw className="h-3 w-3" />
                  Re-run with edits
                </button>
              </div>
            </div>
          )}

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
