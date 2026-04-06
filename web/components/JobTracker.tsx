'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type Step = { label: string; done: boolean }

export function JobTracker({ jobId, onComplete }: { jobId: number; onComplete?: (job: any) => void }) {
  const [steps, setSteps] = useState<Step[]>([
    { label: 'Sending to Agent', done: true },
    { label: 'Agent Executing...', done: false },
    { label: 'Task Completed', done: false },
  ])
  const [status, setStatus] = useState<'running' | 'done' | 'failed'>('running')
  const [result, setResult] = useState<any>(null)

  useEffect(() => {
    if (!jobId || status !== 'running') return
    const interval = setInterval(async () => {
      try {
        const job = await api.jobs.get(jobId).catch(() => null)
        if (!job) {
          console.log(`[JobTracker] Job #${jobId}: not found yet, keep polling`)
          return
        }
        console.log(`[JobTracker] Job #${jobId}: status=${job.status}`)
        if (job.status === 'IN_PROGRESS' || job.status === 'PENDING_REVIEW' || job.status === 'OPEN') {
          setSteps((s) => s.map((step, i) => ({ ...step, done: i <= (job.status === 'IN_PROGRESS' ? 1 : 0) })))
        } else if (job.status === 'SETTLED') {
          setSteps((s) => s.map((step) => ({ ...step, done: true })))
          setStatus('done')
          setResult(job)
          onComplete?.(job)
          clearInterval(interval)
        } else if (job.status === 'DISPUTED' || job.status === 'EXPIRED') {
          setStatus('failed')
          clearInterval(interval)
        }
      } catch (e) {
        console.error(`[JobTracker] Poll error for job #${jobId}:`, e)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [jobId, status, onComplete])

  return (
    <div className="glass-panel p-8 rounded-3xl border border-white/5 text-center space-y-6">
      {status === 'running' && (
        <div className="w-16 h-16 border-4 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin mx-auto" />
      )}
      {status === 'done' && <div className="text-5xl">🎉</div>}
      {status === 'failed' && <div className="text-5xl">❌</div>}

      <h2 className="text-2xl font-bold font-[var(--font-headline)]">
        {status === 'running' ? 'Agent Working...' : status === 'done' ? 'Task Completed!' : 'Execution Failed'}
      </h2>

      <div className="max-w-md mx-auto space-y-3">
        {steps.map((step, i) => (
          <div key={i} className={`flex items-center gap-3 transition-all ${step.done ? 'opacity-100' : 'opacity-30'}`}>
            <span className={`text-lg ${step.done ? '✅' : '⏳'}`}>{step.done ? '✅' : '⏳'}</span>
            <span className="text-xs font-bold uppercase tracking-widest">{step.label}</span>
          </div>
        ))}
      </div>

      {result && (
        <pre className="p-4 bg-black/50 rounded-xl text-xs font-mono overflow-auto max-h-64 text-left text-gray-300">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  )
}
