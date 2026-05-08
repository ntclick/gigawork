'use client'

/**
 * NodeDetailSheet — bottom-slide or side drawer pixel panel showing one workflow node's
 * input/output JSON + ERC-8183 dispatch tx + agent link. 
 * Includes n8n-style tabs: Output (test log), Input (edit JSON), Settings (metadata).
 */
import Link from 'next/link'
import { ChevronDown, ExternalLink, Play, RotateCw, Settings, TerminalSquare, FileJson, X, FlaskConical, Loader2 } from 'lucide-react'
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
  workflowId,
}: {
  detail: NodeDetail | null
  onClose: () => void
  onEdit?: (req: NodeEditRequest) => void
  workflowId?: string
}) {
  if (!detail) return null
  return (
    <NodeDetailSheetInner 
      detail={detail} 
      onClose={onClose} 
      onEdit={onEdit} 
      workflowId={workflowId} 
    />
  )
}

function NodeDetailSheetInner({
  detail,
  onClose,
  onEdit,
  workflowId,
}: {
  detail: NodeDetail
  onClose: () => void
  onEdit?: (req: NodeEditRequest) => void
  workflowId?: string
}) {
  const [activeTab, setActiveTab] = useState<'output' | 'input' | 'settings'>('output')
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
  
  // Test state
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'running' | 'done' | 'error'
    data?: any
    error?: string
    erc8183?: any
  }>({ status: 'idle' })

  // Reset form when detail changes
  useEffect(() => {
    setDraftSkill(detail.skill)
    setDraftInput(initialInputJson)
    setDraftNote('')
    setEditError(null)
    setTestResult({ status: 'idle' })
    setActiveTab(detail.output ? 'output' : 'input')
  }, [detail.id, detail.skill, initialInputJson, detail.output])

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleTest = async () => {
    if (!workflowId) return
    setTestResult({ status: 'running' })
    try {
      let parsedInput = {}
      if (draftInput.trim()) {
        parsedInput = JSON.parse(draftInput)
      }
      const res = await fetch(`/api/workflow/${workflowId}/test-node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: detail.id,
          skillName: draftSkill,
          input: parsedInput,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Test failed')
      }
      setTestResult({
        status: 'done',
        data: data.output,
        erc8183: data.erc8183,
      })
    } catch (e) {
      setTestResult({
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const handleApplyEdit = () => {
    if (!onEdit) return
    let parsedJson = draftInput.trim()
    if (parsedJson) {
      try {
        JSON.parse(parsedJson)
      } catch (e) {
        setEditError('Input JSON invalid: ' + (e instanceof Error ? e.message : 'parse error'))
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
    onClose()
  }

  const statusColor: Record<typeof detail.status, string> = {
    pending: 'border-white/30 bg-white/5 text-white/55',
    running: 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200',
    completed: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200',
    failed: 'border-red-400/50 bg-red-500/15 text-red-200',
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="gw-drawer-in-right flex w-full max-w-[500px] flex-col border-l-2 border-black bg-[var(--giga-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-black bg-[var(--giga-sidebar)] px-4 py-3">
          <div className="min-w-0 flex-1 truncate">
            <div className="text-[10px] uppercase tracking-wider text-white/55">
              Node {detail.id.slice(0, 8)}
            </div>
            <div className="truncate font-pixel-header text-[15px] text-white">
              {detail.label}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-3 inline-flex h-8 w-8 items-center justify-center text-white/55 transition-colors hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Status Bar */}
        <div className="flex flex-wrap items-center gap-2 border-b-2 border-black/50 bg-black/20 px-4 py-2">
          <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusColor[detail.status]}`}>
            {detail.status}
          </span>
          <Link
            href={`/agents/${detail.skill}`}
            className="border border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--giga-accent)] hover:bg-[var(--giga-accent)] hover:text-black"
          >
            {detail.skill}
          </Link>
          {detail.dispatchTx && (
            <a
              href={`${EXPLORER}/tx/${detail.dispatchTx}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
            >
              ERC-8183 tx <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-black bg-[#12101f]">
          <TabButton
            active={activeTab === 'output'}
            onClick={() => setActiveTab('output')}
            icon={<TerminalSquare className="h-3.5 w-3.5" />}
            label="Output"
          />
          <TabButton
            active={activeTab === 'input'}
            onClick={() => setActiveTab('input')}
            icon={<FileJson className="h-3.5 w-3.5" />}
            label="Input"
          />
          <TabButton
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
            icon={<Settings className="h-3.5 w-3.5" />}
            label="Settings"
          />
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {activeTab === 'output' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white/70">Execution Output</h3>
                <button
                  onClick={handleTest}
                  disabled={testResult.status === 'running' || !workflowId}
                  className="flex items-center gap-1.5 border border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 px-3 py-1.5 text-[11px] font-bold text-[var(--giga-accent)] transition hover:bg-[var(--giga-accent)] hover:text-black disabled:opacity-50"
                >
                  {testResult.status === 'running' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  {testResult.status === 'running' ? 'Testing...' : 'Test this step'}
                </button>
              </div>

              {testResult.status === 'error' && (
                <div className="border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                  <span className="font-bold">Test Failed:</span> {testResult.error}
                </div>
              )}

              {testResult.erc8183 && (
                <div className="border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                  <div className="mb-2 flex items-center gap-1.5 font-bold text-emerald-400">
                    <FlaskConical className="h-3.5 w-3.5" /> ERC-8183 Attestation
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-emerald-200/70">
                    <div>Chain: {testResult.erc8183.chain}</div>
                    <div>Agent NFT: {testResult.erc8183.identity_token ?? 'none'}</div>
                    <div className="col-span-2">
                      Tx:{' '}
                      <a
                        href={`${EXPLORER}/tx/${testResult.erc8183.dispatch_tx}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-400 underline hover:text-emerald-300"
                      >
                        {testResult.erc8183.dispatch_tx}
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {testResult.data !== undefined ? (
                <CollapsibleJson label="Test Result" value={testResult.data} expanded={true} />
              ) : detail.output !== undefined ? (
                <CollapsibleJson
                  label={detail.status === 'failed' ? 'Error' : 'Output'}
                  value={detail.output}
                  expanded={true}
                  tone={detail.status === 'failed' ? 'error' : undefined}
                />
              ) : (
                <div className="rounded border border-dashed border-white/10 bg-white/[0.02] py-8 text-center">
                  <FlaskConical className="mx-auto mb-2 h-5 w-5 text-white/30" />
                  <p className="text-xs text-white/50">No output yet</p>
                  <p className="mt-1 text-[10px] text-white/30">
                    Click "Test this step" to run the skill directly.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'input' && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/70">Input Parameters</h3>
              <div>
                <label className="mb-1.5 block text-[11px] text-white/60">Edit JSON</label>
                <textarea
                  value={draftInput}
                  onChange={(e) => setDraftInput(e.target.value)}
                  rows={12}
                  className="w-full resize-y border-2 border-black bg-[#1f1f33] px-3 py-3 font-mono text-xs leading-relaxed text-emerald-300 placeholder:text-white/20 focus:border-[var(--giga-accent)] focus:outline-none"
                  spellCheck={false}
                />
              </div>
              {editError && (
                <div className="border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                  {editError}
                </div>
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/70">Node Settings</h3>
              
              <div>
                <label className="mb-1.5 block text-[11px] text-white/60">Provider (Skill)</label>
                <select
                  value={draftSkill}
                  onChange={(e) => setDraftSkill(e.target.value)}
                  className="w-full border-2 border-black bg-[#1f1f33] px-3 py-2.5 text-sm text-white focus:border-[var(--giga-accent)] focus:outline-none"
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
                <label className="mb-1.5 block text-[11px] text-white/60">
                  Notes for Hermes <span className="text-white/30">(optional)</span>
                </label>
                <textarea
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  placeholder="e.g. use Solana instead of Ethereum..."
                  rows={4}
                  className="w-full resize-none border-2 border-black bg-[#1f1f33] px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:border-[var(--giga-accent)] focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {(activeTab === 'input' || activeTab === 'settings') && onEdit && (
          <div className="border-t-2 border-black bg-[var(--giga-sidebar)] p-4">
            <button
              onClick={handleApplyEdit}
              className="flex w-full items-center justify-center gap-2 border-2 border-black bg-[var(--giga-accent)] px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-yellow-300"
            >
              <RotateCw className="h-4 w-4" />
              Save & Re-run Node
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 border-r-2 border-black py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors last:border-r-0 ${
        active
          ? 'bg-[var(--giga-panel)] text-[var(--giga-accent)]'
          : 'text-white/40 hover:bg-[#1a1829] hover:text-white/70'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function CollapsibleJson({ label, value, expanded: defaultExpanded = false, tone }: { label: string; value: unknown; expanded?: boolean; tone?: 'error' }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  let formatted: string
  try {
    formatted = JSON.stringify(value, null, 2)
  } catch {
    formatted = String(value)
  }
  const lines = formatted.split('\n').length
  
  return (
    <div className="border border-black bg-[#0d0f14]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between bg-black/40 px-3 py-2 text-left text-[11px] uppercase tracking-wider text-white/65 hover:text-white"
      >
        <span className={tone === 'error' ? 'text-red-400' : 'text-emerald-400'}>{label}</span>
        <span className="flex items-center gap-1.5 text-[10px] text-white/45">
          {lines} lines
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {expanded && (
        <pre className="max-h-[50vh] overflow-auto p-3 font-mono text-[11px] leading-relaxed text-white/85">
          {formatted}
        </pre>
      )}
    </div>
  )
}
