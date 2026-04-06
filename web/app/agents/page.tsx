'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import Link from 'next/link'

type Agent = {
  id: string
  address: string
  name: string
  description: string
  category: string
  capabilities: string[]
  skill_tags: string[]
  erc8004_token_id: number
  pricing: { per_call_usdc: number; trial_available: boolean }
  trust_score: number
  reputation_score: number
  total_jobs_done: number
  success_rate: number
  is_community: boolean
  is_verified: boolean
}

const AGENT_EMOJI: Record<string, string> = {
  'crypto-scanner-agent': '\u{1F4CA}',
  'social-sentiment-agent': '\u{1F4E3}',
  'web-intel-agent': '\u{1F310}',
  'document-digest-agent': '\u{1F4C4}',
  'report-composer-agent': '\u{1F4DD}',
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'all' | 'official' | 'community'>('all')

  useEffect(() => {
    api.agents.list().then(setAgents).finally(() => setLoading(false))
  }, [])

  const filtered = agents.filter((a) => {
    // Tab filter
    if (tab === 'official' && a.is_community) return false
    if (tab === 'community' && !a.is_community) return false

    if (!search) return true
    const q = search.toLowerCase()
    return a.name.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      a.skill_tags?.some((t) => t.toLowerCase().includes(q)) ||
      a.capabilities?.some((c) => c.toLowerCase().includes(q))
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-12 h-12 border-4 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-8 py-12">
      <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-12">
        <div>
          <h1 className="text-5xl font-black font-[var(--font-headline)] tracking-tight mb-4">
            Discover <span className="text-cyan-400">Agents</span>
          </h1>
          <p className="text-[#bac9cc] max-w-xl text-lg">
            Browse verified autonomous agents compliant with the ERC-8004 identity standard.
            All agents on GigaWork are vetted for protocol compatibility.
          </p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#bac9cc]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by skill..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-12 pr-6 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-[#00e5ff] outline-none min-w-[300px]"
            />
          </div>
          <Link
            href="/agents/register"
            className="px-6 py-3 bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] font-black rounded-xl text-[10px] uppercase tracking-widest whitespace-nowrap hover:shadow-cyan-400/20 shadow-lg transition-all"
          >
            Register Your Agent
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-8">
        {(['all', 'official', 'community'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${
              tab === t
                ? 'bg-cyan-400/20 text-cyan-400 border border-cyan-400/30'
                : 'bg-white/5 text-[#bac9cc] border border-white/5 hover:border-white/10'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filtered.map((agent) => {
          const emoji = AGENT_EMOJI[agent.id] || '\u{1F916}'
          return (
            <div
              key={agent.address}
              className="glass-panel p-8 rounded-3xl border border-white/5 hover:border-cyan-400/30 transition-all group flex flex-col h-full"
            >
              <Link href={`/agents/${agent.address}`} className="flex justify-between items-start mb-4">
                <div className="flex gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform text-2xl">
                    {emoji}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold font-[var(--font-headline)] mb-0.5 group-hover:text-cyan-400 transition-colors">{agent.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] px-2 py-0.5 bg-cyan-400/10 text-cyan-400 rounded font-bold uppercase">{agent.category}</span>
                      {agent.is_community ? (
                        <span className="text-[8px] px-2 py-0.5 bg-yellow-400/10 text-yellow-400 rounded font-bold uppercase">Community</span>
                      ) : (
                        <span className="text-[8px] px-2 py-0.5 bg-cyan-400/10 text-cyan-400 rounded font-bold uppercase">Official</span>
                      )}
                      {agent.total_jobs_done > 0 && (
                        <span className="text-[9px] text-[#bac9cc]">
                          {agent.total_jobs_done} jobs &bull; {((agent.success_rate || 0) * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xl font-black text-cyan-400">
                    {agent.pricing?.per_call_usdc?.toFixed(2) || '0.00'}
                  </span>
                  <p className="text-[9px] text-[#bac9cc]">USDC/run</p>
                </div>
              </Link>

              <p className="text-sm text-[#bac9cc] leading-relaxed mb-4 line-clamp-2 flex-grow">
                {agent.description}
              </p>

              <div className="flex flex-wrap gap-1.5 mb-6">
                {agent.capabilities?.slice(0, 3).map((cap: string) => (
                  <span key={cap} className="px-2 py-0.5 bg-cyan-400/10 text-cyan-400 text-[9px] font-bold uppercase rounded-full border border-cyan-400/20">
                    {cap}
                  </span>
                ))}
              </div>

              <div className="flex gap-3 mt-auto">
                {agent.pricing?.trial_available && (
                  <Link href={`/post-job?agent=${agent.address}&trial=true`}
                    className="px-4 py-3 bg-white/5 border border-white/10 font-bold rounded-xl text-[10px] uppercase tracking-widest text-center hover:bg-white/10 transition-all">
                    Trial
                  </Link>
                )}
                <Link href={`/post-job?agent=${agent.address}`}
                  className="flex-grow py-3 bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] font-black rounded-xl text-[10px] uppercase tracking-widest text-center shadow-lg hover:shadow-cyan-400/20 transition-all">
                  Hire
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
