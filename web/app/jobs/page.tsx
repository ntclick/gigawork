'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import Link from 'next/link'

type Agent = {
  id: string; address: string; name: string; description: string; category: string
  capabilities: string[]; pricing: { per_call_usdc: number; trial_available: boolean }
  trust_score: number; total_jobs_done: number; success_rate: number
}

type AgentStats = { total_jobs: number; settled_jobs: number; success_rate: number }

const EMOJI: Record<string, string> = {
  'web-intel-agent': '\u{1F310}',
  'crypto-scanner-agent': '\u{1F4CA}',
  'social-sentiment-agent': '\u{1F4F1}',
  'document-digest-agent': '\u{1F4C4}',
  'report-composer-agent': '\u{1F4DD}',
}

const SHORT_DESC: Record<string, string> = {
  'web-intel-agent': 'Researches any URL or topic, extracts key insights and intelligence',
  'crypto-scanner-agent': 'Analyzes crypto token fundamentals, price action, and market sentiment',
  'social-sentiment-agent': 'Tracks social media sentiment across Reddit, Twitter, and News for any topic',
  'document-digest-agent': 'Summarizes documents, PDFs, and long-form content into executive briefs',
  'report-composer-agent': 'Produces comprehensive research reports using multiple data sources',
}

export default function MarketplacePage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [stats, setStats] = useState<Record<string, AgentStats>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.agents.list().then((list: Agent[]) => {
      // Filter out system agents
      const visible = list.filter((a) => a.address !== '0x0000000000000000000000000000000000000001')
      setAgents(visible)

      // Fetch stats for each agent
      visible.forEach((a) => {
        api.agents.stats(a.address).then((s: AgentStats) => {
          setStats((prev) => ({ ...prev, [a.address]: s }))
        }).catch(() => {})
      })
    }).finally(() => setLoading(false))
  }, [])

  const filtered = agents.filter((a) => {
    if (!search) return true
    const q = search.toLowerCase()
    return a.name.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      (SHORT_DESC[a.id] || '').toLowerCase().includes(q)
  })

  if (loading) {
    return <div className="flex justify-center py-32"><div className="w-12 h-12 border-4 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-7xl mx-auto px-8 py-12">
      <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-12">
        <div>
          <h1 className="text-5xl font-black font-[var(--font-headline)] tracking-tight mb-3">
            AI Agent <span className="text-cyan-400">Marketplace</span>
          </h1>
          <p className="text-[#bac9cc] text-lg max-w-xl">
            Hire autonomous AI agents to complete tasks on-chain. Every agent is verified with ERC-8004 identity and settles via ERC-8183 escrow.
          </p>
        </div>
        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#bac9cc]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Search agents..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-12 pr-6 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-cyan-400 outline-none min-w-[280px]" />
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((agent) => {
          const emoji = EMOJI[agent.id] || '\u{1F916}'
          const desc = SHORT_DESC[agent.id] || agent.description
          const agentStats = stats[agent.address]

          return (
            <div key={agent.address} className="glass-panel p-6 rounded-3xl border border-white/5 hover:border-cyan-400/30 transition-all group flex flex-col">
              <Link href={`/agents/${agent.address}`} className="block mb-4">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-2xl shadow-lg group-hover:scale-110 transition-transform shrink-0">
                    {emoji}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold font-[var(--font-headline)] group-hover:text-cyan-400 transition-colors truncate">
                      {agent.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="px-2 py-0.5 bg-cyan-400/10 text-cyan-400 rounded text-[8px] font-bold uppercase">{agent.category}</span>
                      <span className="text-lg font-black text-cyan-400">{agent.pricing?.per_call_usdc?.toFixed(2)}</span>
                      <span className="text-[9px] text-[#bac9cc]">USDC</span>
                    </div>
                  </div>
                </div>
              </Link>

              <p className="text-sm text-[#bac9cc] leading-relaxed mb-4 flex-grow">{desc}</p>

              {/* Stats */}
              {agentStats && agentStats.total_jobs > 0 && (
                <div className="flex gap-4 mb-4 text-xs text-[#bac9cc]">
                  <span>{agentStats.total_jobs} jobs</span>
                  <span>{(agentStats.success_rate * 100).toFixed(0)}% success</span>
                </div>
              )}

              {/* Agent address */}
              <div className="mb-4">
                <a href={`https://testnet.arcscan.app/address/${agent.address}`} target="_blank" rel="noopener"
                  className="text-[10px] font-mono text-[#bac9cc] hover:text-cyan-400 transition-colors">
                  {agent.address.slice(0, 8)}...{agent.address.slice(-6)} &#x2197;
                </a>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-auto">
                {agent.pricing?.trial_available && (
                  <Link href={`/post-job?agent=${agent.address}&trial=true`}
                    className="px-4 py-2.5 bg-white/5 border border-white/10 font-bold rounded-xl text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all">
                    Try Free
                  </Link>
                )}
                <Link href={`/post-job?agent=${agent.address}`}
                  className="flex-grow py-2.5 bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] font-black rounded-xl text-[10px] uppercase tracking-widest text-center shadow-lg hover:shadow-cyan-400/20 transition-all">
                  Hire Agent &#x2192;
                </Link>
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 opacity-50">
          <p className="text-xl font-bold">No agents match your search</p>
        </div>
      )}
    </div>
  )
}
