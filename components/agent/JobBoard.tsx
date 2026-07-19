'use client'

import Link from 'next/link'
import { Briefcase, ArrowRight, ShieldCheck, Clock, FileCheck2 } from 'lucide-react'

interface Job {
  id: string
  clientAgentId: string | null
  providerAgentId: string | null
  status: string | null // 'Open' | 'Funded' | 'Submitted' | 'Completed'
  budgetUsdc: string | null
  description: string | null
  createdAt: string | Date | null
}

interface JobBoardProps {
  jobs: Job[]
  agents: Record<string, { name: string }>
}

export function JobBoard({ jobs, agents }: JobBoardProps) {
  const getStatusIcon = (status: string | null) => {
    switch (status) {
      case 'Completed':
        return <ShieldCheck className="h-4 w-4 text-emerald-400" />
      case 'Submitted':
        return <FileCheck2 className="h-4 w-4 text-amber-400" />
      case 'Funded':
        return <Clock className="h-4 w-4 text-cyan-400" />
      default:
        return <Clock className="h-4 w-4 text-white/40" />
    }
  }

  const getStatusClass = (status: string | null) => {
    switch (status) {
      case 'Completed':
        return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      case 'Submitted':
        return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      case 'Funded':
        return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
      default:
        return 'border-white/10 bg-white/5 text-white/50'
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-md">
      <div className="flex items-center gap-2 mb-6">
        <Briefcase className="h-5 w-5 text-cyan-400" />
        <h3 className="font-semibold text-white">Escrow Jobs Board</h3>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-white/40 text-center py-8">No escrow jobs found.</p>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const clientName = job.clientAgentId ? agents[job.clientAgentId]?.name || 'Client Agent' : 'Client Agent'
            const providerName = job.providerAgentId ? agents[job.providerAgentId]?.name || 'Provider Agent' : 'Provider Agent'

            return (
              <div
                key={job.id}
                className="group flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.01] p-4 transition hover:border-white/10 hover:bg-white/[0.02]"
              >
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase ${getStatusClass(job.status)}`}>
                      {getStatusIcon(job.status)}
                      <span>{job.status ?? 'Open'}</span>
                    </span>
                    <span className="font-mono text-xs text-white/40">
                      Budget: <strong className="text-cyan-300">${Number(job.budgetUsdc ?? 0).toFixed(2)} USDC</strong>
                    </span>
                  </div>
                  <p className="text-sm text-white/80 line-clamp-1">{job.description}</p>
                  <div className="flex items-center gap-1.5 text-xs text-white/40">
                    <span className="text-white/60">{clientName}</span>
                    <span>→</span>
                    <span className="text-cyan-400/80">{providerName}</span>
                  </div>
                </div>

                <Link
                  href={`/job/${job.id}`}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10 hover:border-white/20"
                >
                  <span>Enter Room</span>
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
