'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'
import Link from 'next/link'

type Agent = {
  id: string; address: string; name: string; description: string; category: string
  capabilities: string[]; skill_tags: string[]; erc8004_token_id: number
  pricing: { per_call_usdc: number; trial_available: boolean }
  trust_score: number; reputation_score: number; operator_wallet: string
  input_schema: any; metadata: any
}

type Stats = {
  total_jobs: number; settled_jobs: number; success_rate: number
  avg_response_time_s: number; sample_output: any
}

const AGENT_EMOJI: Record<string, string> = {
  'crypto-scanner-agent': '\u{1F4CA}',
  'social-sentiment-agent': '\u{1F4E3}',
  'web-intel-agent': '\u{1F310}',
  'document-digest-agent': '\u{1F4C4}',
  'report-composer-agent': '\u{1F4DD}',
}

export default function AgentDetailPage() {
  const params = useParams()
  const address = params.address as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [showSample, setShowSample] = useState(false)

  useEffect(() => {
    if (!address) return
    Promise.all([
      api.agents.get(address).catch(() => null),
      api.agents.stats(address).catch(() => null),
    ]).then(([a, s]) => {
      setAgent(a)
      setStats(s)
    }).finally(() => setLoading(false))
  }, [address])

  if (loading) {
    return <div className="flex justify-center py-32"><div className="w-12 h-12 border-4 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" /></div>
  }

  if (!agent) {
    return <div className="max-w-4xl mx-auto px-8 py-24 text-center"><h1 className="text-2xl font-bold text-red-400">Agent not found</h1></div>
  }

  const emoji = AGENT_EMOJI[agent.id] || '\u{1F916}'

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      {/* Header */}
      <div className="glass-panel p-8 rounded-3xl border border-white/5 mb-8">
        <div className="flex items-start gap-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-4xl shadow-lg">
            {emoji}
          </div>
          <div className="flex-grow">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-black font-[var(--font-headline)]">{agent.name}</h1>
              <span className="px-2 py-0.5 bg-cyan-400/10 text-cyan-400 rounded text-[9px] font-bold uppercase">{agent.category}</span>
            </div>
            <p className="text-[#bac9cc] text-lg mb-4">{agent.description}</p>
            <div className="flex flex-wrap gap-2">
              {agent.capabilities?.map((cap) => (
                <span key={cap} className="px-3 py-1 bg-white/5 border border-white/10 text-[10px] font-bold uppercase rounded-full text-[#bac9cc]">{cap}</span>
              ))}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-3xl font-black text-cyan-400">{agent.pricing?.per_call_usdc?.toFixed(2)}</p>
            <p className="text-[10px] text-[#bac9cc] uppercase tracking-widest">USDC / run</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Jobs', value: stats.total_jobs, color: '' },
            { label: 'Settled', value: stats.settled_jobs, color: 'text-emerald-400' },
            { label: 'Success Rate', value: `${(stats.success_rate * 100).toFixed(0)}%`, color: stats.success_rate >= 0.9 ? 'text-emerald-400' : 'text-amber-400' },
            { label: 'Avg Time', value: stats.avg_response_time_s > 0 ? `${stats.avg_response_time_s.toFixed(0)}s` : '—', color: '' },
          ].map((s) => (
            <div key={s.label} className="glass-panel p-4 rounded-2xl border border-white/5 text-center">
              <p className="text-[9px] uppercase tracking-widest font-bold text-[#bac9cc] mb-1">{s.label}</p>
              <p className={`text-2xl font-black font-[var(--font-headline)] ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Input Schema */}
      {agent.input_schema?.properties && (
        <div className="glass-panel p-8 rounded-3xl border border-white/5 mb-8">
          <h2 className="text-xl font-bold font-[var(--font-headline)] mb-4">Input Fields</h2>
          <div className="space-y-3">
            {Object.entries(agent.input_schema.properties).map(([key, prop]: [string, any]) => (
              <div key={key} className="flex items-center gap-4 p-3 bg-white/5 rounded-xl">
                <div className="flex-grow">
                  <p className="font-bold text-sm">{prop.title || key}</p>
                  {prop.placeholder && <p className="text-xs text-[#bac9cc]">{prop.placeholder}</p>}
                </div>
                <div className="text-right">
                  <span className="text-[9px] font-bold uppercase text-[#bac9cc] bg-white/5 px-2 py-0.5 rounded">
                    {prop.enum ? 'select' : prop.type || 'text'}
                  </span>
                  {agent.input_schema.required?.includes(key) && (
                    <span className="text-[9px] font-bold text-red-400 ml-2">required</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sample Output */}
      {stats?.sample_output && (
        <div className="glass-panel p-8 rounded-3xl border border-white/5 mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold font-[var(--font-headline)]">Sample Output</h2>
            <button onClick={() => setShowSample(!showSample)} className="text-xs text-cyan-400 hover:text-cyan-300 font-bold">
              {showSample ? 'Hide' : 'Show'}
            </button>
          </div>
          {showSample && (
            <pre className="p-4 bg-black/50 rounded-xl text-xs font-mono text-gray-300 whitespace-pre-wrap overflow-auto max-h-64">
              {JSON.stringify(stats.sample_output, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* On-chain Identity */}
      <div className="glass-panel p-8 rounded-3xl border border-white/5 mb-8">
        <h2 className="text-xl font-bold font-[var(--font-headline)] mb-4">On-Chain Identity</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[#bac9cc]">Agent Address</span>
            <a href={`https://testnet.arcscan.app/address/${agent.address}`} target="_blank" rel="noopener"
              className="font-mono text-cyan-400 hover:text-cyan-300">{agent.address.slice(0, 10)}...{agent.address.slice(-8)} &#x2197;</a>
          </div>
          <div className="flex justify-between">
            <span className="text-[#bac9cc]">Owner Wallet</span>
            <span className="font-mono text-white">{agent.operator_wallet?.slice(0, 10)}...{agent.operator_wallet?.slice(-8)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#bac9cc]">ERC-8004 Token</span>
            <span className="font-mono text-white">#{agent.erc8004_token_id || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#bac9cc]">Trust Score</span>
            <span className="font-bold text-white">{agent.trust_score}/100</span>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="flex gap-4">
        {agent.pricing?.trial_available && (
          <Link href={`/post-job?agent=${agent.address}&trial=true`}
            className="flex-1 py-4 bg-white/5 border border-white/10 text-center font-bold rounded-2xl hover:bg-white/10 text-lg">
            Try Free
          </Link>
        )}
        <Link href={`/post-job?agent=${agent.address}`}
          className="flex-1 py-4 bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] font-black text-center rounded-2xl shadow-xl hover:scale-[1.02] transition-all text-lg">
          Hire Agent ({agent.pricing?.per_call_usdc?.toFixed(2)} USDC)
        </Link>
      </div>
    </div>
  )
}
