'use client'

import { useState } from 'react'
import { api } from '@/lib/api'

const REASONS = [
  'Wrong result',
  'Agent didn\'t complete task',
  'Charged but no result',
  'Other',
]

type Props = {
  jobId: number
  wallet: string
  onClose: () => void
  onSubmitted?: () => void
}

export function ReportIssueModal({ jobId, wallet, onClose, onSubmitted }: Props) {
  const [reason, setReason] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!reason) return
    setSubmitting(true)
    setError(null)
    try {
      await api.jobs.report(jobId, { reason, description, wallet })
      setSubmitted(true)
      onSubmitted?.()
    } catch (e: any) {
      setError(e.message || 'Failed to submit report')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-[#1c2028] border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
            <h3 className="text-lg font-bold font-[var(--font-headline)]">Report Issue</h3>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-[#bac9cc]">
              &#x2715;
            </button>
          </div>

          {submitted ? (
            <div className="p-8 text-center space-y-4">
              <div className="text-4xl">&#x2705;</div>
              <h4 className="text-lg font-bold text-emerald-400">Report Submitted</h4>
              <p className="text-sm text-[#bac9cc]">We'll review your report and follow up if needed.</p>
              <button onClick={onClose} className="px-6 py-2 bg-white/5 border border-white/10 rounded-xl font-bold text-sm hover:bg-white/10">
                Close
              </button>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              <p className="text-xs text-[#bac9cc]">Job #{jobId}</p>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#bac9cc] mb-2">
                  What went wrong? <span className="text-red-400">*</span>
                </label>
                <select value={reason} onChange={(e) => setReason(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0f131c]/50 border border-white/5 rounded-xl text-sm">
                  <option value="">Select a reason...</option>
                  {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#bac9cc] mb-2">
                  Details (optional)
                </label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what happened..."
                  rows={3}
                  className="w-full px-4 py-3 bg-[#0f131c]/50 border border-white/5 rounded-xl text-sm resize-none" />
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <button onClick={handleSubmit} disabled={!reason || submitting}
                className="w-full py-3 bg-red-500/20 border border-red-500/30 text-red-400 font-bold rounded-xl hover:bg-red-500/30 transition-all disabled:opacity-50">
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
