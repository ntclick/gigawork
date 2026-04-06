'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useWallet } from '@/hooks/useWallet'
import { useAuth } from '@/hooks/useAuth'
import { StatusBadge } from '@/components/StatusBadge'
import Link from 'next/link'

type Job = {
  job_id: number; job_type: string; status: string; worker_agent?: string
  hourly_rate_usdc?: number; actual_charge?: number; billing_unit?: string
  worker_payout?: number; platform_fee?: number
  result_hash?: string; proof_uri?: string; employer_rating?: number
  tx_hash_posted?: string; tx_hash_accepted?: string; tx_hash_settled?: string
  created_at: string; updated_at: string
}

function ResultContent({ data }: { data: any }) {
  if (!data) {
    return <p className="text-sm text-[#bac9cc]">No result data available.</p>
  }

  // String content
  if (typeof data === 'string') {
    return (
      <pre className="p-4 bg-black/50 rounded-xl text-xs font-mono text-gray-300 whitespace-pre-wrap overflow-auto max-h-96">
        {data}
      </pre>
    )
  }

  // Object: render key-value pairs
  if (typeof data === 'object') {
    const entries = Object.entries(data)
    return (
      <div className="space-y-3">
        {entries.map(([key, value]) => {
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          const isLong = typeof value === 'string' && value.length > 120
          const isArray = Array.isArray(value)
          const isObj = typeof value === 'object' && value !== null && !isArray

          return (
            <div key={key}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#bac9cc] mb-1">{label}</p>
              {isArray ? (
                <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                  {(value as any[]).map((item, i) => (
                    <li key={i} className="text-xs">
                      {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                    </li>
                  ))}
                </ul>
              ) : isObj ? (
                <pre className="p-3 bg-black/50 rounded-lg text-xs font-mono text-gray-300 whitespace-pre-wrap overflow-auto max-h-48">
                  {JSON.stringify(value, null, 2)}
                </pre>
              ) : isLong ? (
                <p className="text-sm text-gray-300 leading-relaxed">{String(value)}</p>
              ) : (
                <p className="text-sm text-white font-medium">{String(value)}</p>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return <p className="text-sm text-white">{String(data)}</p>
}

export default function DashboardPage() {
  const { address, isConnected, login } = useWallet()
  useAuth() // sync session with backend

  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [viewJob, setViewJob] = useState<any>(null)

  useEffect(() => {
    if (!address) return
    api.jobs.list(`employer=${address}`).then(setJobs).catch(() => {}).finally(() => setLoading(false))
  }, [address])

  const settled = jobs.filter((j) => j.status === 'SETTLED')
  const active = jobs.filter((j) => ['IN_PROGRESS', 'MATCHING', 'OPEN', 'PENDING_REVIEW'].includes(j.status))
  const totalSpent = settled.reduce((s, j) => s + (j.hourly_rate_usdc || 0), 0)

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-24 text-center">
        <h1 className="text-3xl font-black font-[var(--font-headline)] mb-4">My Jobs</h1>
        <p className="text-[#bac9cc] mb-6">Sign in to view your jobs.</p>
        <button onClick={login} className="px-6 py-3 bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] font-bold rounded-xl">Sign In</button>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-8 py-12">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-6 mb-12">
        {[
          { label: 'Total Jobs', value: jobs.length, color: '' },
          { label: 'Active', value: active.length, color: 'text-cyan-400' },
          { label: 'Completed', value: settled.length, color: 'text-emerald-400' },
          { label: 'Spent', value: `${totalSpent.toFixed(2)} USDC`, color: '' },
        ].map((s) => (
          <div key={s.label} className="glass-panel p-6 rounded-3xl border border-white/5">
            <p className="text-[10px] uppercase tracking-widest font-bold text-[#bac9cc] mb-2">{s.label}</p>
            <p className={`text-3xl font-black font-[var(--font-headline)] ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <h2 className="text-3xl font-black font-[var(--font-headline)] tracking-tighter mb-8">
        My <span className="text-cyan-400">Tasks</span>
      </h2>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-12 h-12 border-4 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" /></div>
      ) : jobs.length === 0 ? (
        <div className="glass-panel p-12 rounded-3xl border border-dashed border-white/10 text-center">
          <p className="text-[#bac9cc] font-bold">No active missions.</p>
          <Link href="/agents" className="mt-4 inline-block text-cyan-400 font-bold hover:underline">Deploy an Agent →</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <div key={job.job_id} className="glass-panel p-6 rounded-3xl border border-white/5 hover:border-cyan-400/30 transition-all flex items-center gap-6">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${
                job.status === 'SETTLED' ? 'bg-emerald-400/10' :
                job.status === 'DISPUTED' ? 'bg-red-400/10' :
                'bg-cyan-400/10'
              }`}>
                {job.status === 'SETTLED' ? '✅' : job.status === 'DISPUTED' ? '❌' : '⚡'}
              </div>

              <div className="flex-grow">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-bold">{job.job_type}</h3>
                  <StatusBadge status={job.status} />
                </div>
                <p className="text-xs text-[#bac9cc] font-mono">
                  ID: {job.job_id} {job.worker_agent && `• ${job.worker_agent.slice(0, 12)}...`}
                </p>
              </div>

              <div className="text-right">
                {(job.actual_charge || job.hourly_rate_usdc) && (
                  <p className="font-bold">
                    {(job.actual_charge || job.hourly_rate_usdc || 0).toFixed(2)} <span className="text-xs text-[#bac9cc]">USDC</span>
                  </p>
                )}
                {job.billing_unit === 'server' && (
                  <p className="text-[9px] text-cyan-400/70">Paid by Platform</p>
                )}
              </div>

              {job.status === 'SETTLED' && (
                <button
                  onClick={async () => {
                    try {
                      const [full, result] = await Promise.all([
                        api.jobs.get(job.job_id),
                        api.jobs.result(job.job_id).catch(() => null),
                      ])
                      console.log('[Dashboard] Job detail:', full)
                      console.log('[Dashboard] Job result:', result)
                      setViewJob({ ...full, _result: result?.output ?? null })
                    } catch {}
                  }}
                  className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs hover:bg-white/10"
                >
                  View
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Result Modal */}
      {viewJob && (
        <>
          <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm" onClick={() => setViewJob(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-[#1c2028] border border-white/10 rounded-3xl shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                <h3 className="text-lg font-bold font-[var(--font-headline)]">
                  Job Result
                </h3>
                <button onClick={() => setViewJob(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-[#bac9cc]">
                  &#x2715;
                </button>
              </div>
              <div className="p-6 overflow-auto flex-1 space-y-4">
                <div className="flex flex-wrap items-center gap-3 text-xs text-[#bac9cc]">
                  <span className="font-mono">ID: {viewJob.job_id}</span>
                  <StatusBadge status={viewJob.status} />
                  {viewJob.worker_agent && (
                    <span className="font-mono">{viewJob.worker_agent.slice(0, 16)}...</span>
                  )}
                </div>

                {/* Transaction links */}
                {(viewJob.tx_hash_posted || viewJob.tx_hash_accepted || viewJob.tx_hash_settled) && (
                  <div className="flex flex-wrap gap-2">
                    {viewJob.tx_hash_posted && (
                      <a href={`https://testnet.arcscan.app/tx/${viewJob.tx_hash_posted}`} target="_blank" rel="noopener"
                        className="px-3 py-1 bg-cyan-400/10 border border-cyan-400/20 rounded-lg text-xs text-cyan-400 hover:bg-cyan-400/20">
                        Create Tx &#x2197;
                      </a>
                    )}
                    {viewJob.tx_hash_accepted && (
                      <a href={`https://testnet.arcscan.app/tx/${viewJob.tx_hash_accepted}`} target="_blank" rel="noopener"
                        className="px-3 py-1 bg-cyan-400/10 border border-cyan-400/20 rounded-lg text-xs text-cyan-400 hover:bg-cyan-400/20">
                        Submit Tx &#x2197;
                      </a>
                    )}
                    {viewJob.tx_hash_settled && (
                      <a href={`https://testnet.arcscan.app/tx/${viewJob.tx_hash_settled}`} target="_blank" rel="noopener"
                        className="px-3 py-1 bg-emerald-400/10 border border-emerald-400/20 rounded-lg text-xs text-emerald-400 hover:bg-emerald-400/20">
                        Complete Tx &#x2197;
                      </a>
                    )}
                  </div>
                )}

                {/* Revenue split */}
                {viewJob.worker_payout != null && (
                  <div className="flex gap-4 text-xs text-[#bac9cc] p-3 bg-white/5 rounded-lg">
                    <span>Agent: <span className="text-white font-bold">{viewJob.worker_payout.toFixed(2)} USDC</span> (80%)</span>
                    <span>Platform: <span className="text-white font-bold">{(viewJob.platform_fee || 0).toFixed(2)} USDC</span> (20%)</span>
                    {viewJob.billing_unit && <span>Paid by: <span className="text-cyan-400">{viewJob.billing_unit}</span></span>}
                  </div>
                )}

                <ResultContent data={viewJob._result ?? viewJob.result_data} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
