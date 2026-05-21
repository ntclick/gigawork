'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, X, XCircle, Zap } from 'lucide-react'

type NodeResult = {
  id: string
  label: string
  kind: string
  status: string
  skillName: string | null
  output: Record<string, unknown> | null
}

type TestData = {
  workflow: { id: string; prompt: string; status: string }
  deployment: { id: string; cronExpression: string; status: string }
  nodeResults: NodeResult[]
  testedAt: string
}

type TestResultModalProps = {
  isOpen: boolean
  onClose: () => void
  deploymentId: string
  workflowTitle: string
}

export function TestResultModal({ isOpen, onClose, deploymentId, workflowTitle }: TestResultModalProps) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<TestData | null>(null)
  const [error, setError] = useState('')
  const [hasRun, setHasRun] = useState(false)

  const runTest = async () => {
    setLoading(true)
    setError('')
    setData(null)
    try {
      const res = await fetch(`/api/deployments/${deploymentId}/test`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setHasRun(true)
    }
  }

  // Auto-run on first open
  if (isOpen && !hasRun && !loading) {
    runTest()
  }

  const handleClose = () => {
    setData(null)
    setError('')
    setHasRun(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden border border-[var(--giga-accent)] bg-[#12101f]/95 shadow-[0_8px_32px_rgba(255,204,77,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-[#17142b] px-6 py-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-[var(--giga-accent)]" />
            <h3 className="font-pixel-header text-sm tracking-wider uppercase text-white">Test Result</h3>
          </div>
          <button type="button" onClick={handleClose} className="text-white/60 hover:text-white transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {/* Workflow title */}
          <div className="mb-4">
            <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Workflow</p>
            <div className="bg-black/40 border border-white/5 p-2.5 font-pixel-body text-xs text-white/80 truncate">
              {workflowTitle}
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--giga-accent)]" />
              <p className="font-pixel-body text-xs text-[var(--giga-accent)] animate-pulse">
                ĐANG KIỂM TRA DEPLOYMENT...
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="flex h-12 w-12 items-center justify-center bg-red-500/20 text-red-400 border border-red-500/40 rounded-full">
                <XCircle className="h-6 w-6" />
              </div>
              <div className="text-center">
                <p className="font-pixel-body text-xs text-red-400 uppercase mb-1">Lỗi kết nối</p>
                <p className="text-[11px] text-white/50">{error}</p>
              </div>
              <button
                type="button"
                onClick={runTest}
                className="mt-2 bg-[var(--giga-accent)] px-4 py-2 font-pixel-body text-[10px] text-black font-bold hover:bg-yellow-300 active:scale-95 transition shadow-[2px_2px_0_0_#000]"
              >
                THỬ LẠI
              </button>
            </div>
          )}

          {/* Results */}
          {data && !loading && (
            <div className="space-y-4">
              {/* Workflow Status */}
              <div className="flex items-center gap-2 mb-3">
                <StatusBadge status={data.workflow.status} />
                <span className="text-[10px] text-white/40 font-mono">
                  {new Date(data.testedAt).toLocaleString()}
                </span>
              </div>

              {/* Node Results */}
              {data.nodeResults.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-white/10 bg-black/10">
                  <p className="font-pixel-body text-[10px] text-white/40 uppercase">
                    Chưa có kết quả. Workflow chưa chạy lần nào.
                  </p>
                </div>
              ) : (
                data.nodeResults.map((node) => (
                  <NodeResultCard key={node.id} node={node} />
                ))
              )}

              {/* Retry */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={runTest}
                  className="bg-white/10 border border-white/10 hover:bg-white/15 px-4 py-2 font-pixel-body text-[10px] text-white uppercase transition active:scale-95"
                >
                  LÀM MỚI
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Sub-components ── */

function StatusBadge({ status }: { status: string }) {
  const isOk = status === 'completed' || status === 'active'
  const isFail = status === 'failed'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-pixel-body font-bold uppercase border ${
        isOk
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : isFail
            ? 'border-red-500/30 bg-red-500/10 text-red-400'
            : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
      }`}
    >
      {isOk ? <CheckCircle2 className="h-2.5 w-2.5" /> : isFail ? <XCircle className="h-2.5 w-2.5" /> : null}
      {status}
    </span>
  )
}

function NodeResultCard({ node }: { node: NodeResult }) {
  const output = node.output as Record<string, unknown> | null
  const isSuccess = node.status === 'completed'
  const isFailed = node.status === 'failed'

  return (
    <div
      className={`border p-4 bg-black/30 space-y-2.5 ${
        isSuccess
          ? 'border-emerald-500/20'
          : isFailed
            ? 'border-red-500/20'
            : 'border-white/10'
      }`}
    >
      {/* Node Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              isSuccess ? 'bg-emerald-400' : isFailed ? 'bg-red-400' : 'bg-yellow-400'
            }`}
          />
          <span className="font-pixel-body text-[11px] text-white uppercase">{node.label}</span>
        </div>
        {node.skillName && (
          <span className="text-[9px] text-white/30 font-mono">{node.skillName}</span>
        )}
      </div>

      {/* Output fields rendered */}
      {output && (
        <div className="space-y-1.5">
          {Object.entries(output).map(([key, value]) => (
            <OutputField key={key} fieldKey={key} value={value} />
          ))}
        </div>
      )}

      {/* No output */}
      {!output && (
        <p className="text-[10px] text-white/30 italic">Chưa có output</p>
      )}
    </div>
  )
}

function OutputField({ fieldKey, value }: { fieldKey: string; value: unknown }) {
  const strValue = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')

  // Special rendering for known fields
  if (fieldKey === 'sent' || fieldKey === 'ok') {
    const ok = value === true
    return (
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-white/40 uppercase font-mono">{fieldKey}</span>
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold border ${
            ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
          }`}
        >
          {ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
          {ok ? 'TRUE' : 'FALSE'}
        </span>
      </div>
    )
  }

  if (fieldKey === 'error') {
    return (
      <div>
        <span className="text-[10px] text-red-400/60 uppercase font-mono block mb-0.5">{fieldKey}</span>
        <div className="bg-red-500/10 border border-red-500/20 p-2 text-[10px] text-red-300 break-all leading-relaxed">
          {strValue}
        </div>
      </div>
    )
  }

  // For long string values (like message body, generated_text)
  if (typeof value === 'string' && value.length > 120) {
    return (
      <div>
        <span className="text-[10px] text-white/40 uppercase font-mono block mb-0.5">{fieldKey}</span>
        <div className="bg-black/40 border border-white/5 p-2 text-[10px] text-white/60 break-all leading-relaxed max-h-28 overflow-y-auto">
          {value}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] text-white/40 uppercase font-mono shrink-0">{fieldKey}</span>
      <span className="text-[10px] text-white/70 font-mono text-right truncate max-w-[250px]">
        {strValue}
      </span>
    </div>
  )
}
