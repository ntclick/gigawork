'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Copy, Check, Shield, Cpu, Briefcase } from 'lucide-react'

interface Agent {
  id: string
  onchainId: string | null
  ownerAddress: string
  agentType: string | null // 'client' | 'provider'
  name: string | null
  description: string | null
  capabilities: string[] | null
  walletAddress: string | null
  reputationScore: string | null
  isActive: boolean | null
}

export function AgentCard({ agent }: { agent: Agent }) {
  const [copied, setCopied] = useState(false)

  const copyAddress = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!agent.walletAddress) return
    navigator.clipboard.writeText(agent.walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const score = Number(agent.reputationScore ?? '0')
  const shortWallet = agent.walletAddress
    ? `${agent.walletAddress.slice(0, 6)}…${agent.walletAddress.slice(-4)}`
    : ''

  const isProvider = agent.agentType === 'provider'

  return (
    <div className="relative group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-cyan-500/30 hover:bg-white/[0.04] hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
      {/* Glow Effect */}
      <div className="absolute -inset-px bg-gradient-to-r from-cyan-500/0 via-cyan-500/0 to-cyan-500/0 rounded-2xl opacity-0 group-hover:opacity-100 group-hover:from-cyan-500/10 group-hover:to-blue-500/10 transition-all duration-500 -z-10" />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
            isProvider 
              ? 'border-cyan-500/30 bg-cyan-500/5 text-cyan-400' 
              : 'border-purple-500/30 bg-purple-500/5 text-purple-400'
          }`}>
            {isProvider ? <Cpu className="h-5 w-5" /> : <Briefcase className="h-5 w-5" />}
          </div>
          <div>
            <h3 className="font-semibold text-white group-hover:text-cyan-300 transition-colors">
              {agent.name ?? 'Unnamed Agent'}
            </h3>
            <span className={`inline-block rounded-full px-2 py-0.5 mt-1 text-[10px] font-semibold tracking-wider uppercase border ${
              isProvider
                ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                : 'border-purple-500/30 bg-purple-500/10 text-purple-300'
            }`}>
              {agent.agentType === 'provider' ? 'Provider' : 'Client'}
            </span>
          </div>
        </div>

        {/* Reputation Score */}
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1 text-amber-400">
            <Shield className="h-4 w-4 fill-amber-400/10" />
            <span className="font-mono text-sm font-bold">{score}</span>
          </div>
          <span className="text-[10px] text-white/40">Reputation</span>
        </div>
      </div>

      {/* Description */}
      <p className="mt-4 text-sm text-white/70 line-clamp-2 min-h-[40px]">
        {agent.description ?? 'No description provided.'}
      </p>

      {/* Wallet Address */}
      {agent.walletAddress && (
        <div className="mt-4 flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/5 px-3 py-1.5 text-xs text-white/50">
          <span className="font-mono">{shortWallet}</span>
          <button
            onClick={copyAddress}
            className="text-white/40 hover:text-white/80 transition-colors p-1 rounded hover:bg-white/5"
            title="Copy address"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      )}

      {/* Capabilities */}
      <div className="mt-5 flex flex-wrap gap-1.5">
        {(agent.capabilities ?? []).slice(0, 3).map((cap, i) => (
          <span
            key={i}
            className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-0.5 text-xs text-white/60"
          >
            {cap}
          </span>
        ))}
        {(agent.capabilities ?? []).length > 3 && (
          <span className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-0.5 text-xs text-white/40">
            +{agent.capabilities!.length - 3} more
          </span>
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Link
          href={`/agent/${agent.id}`}
          className="flex items-center justify-center rounded-xl border border-white/10 px-4 py-2 text-center text-xs font-medium text-white transition hover:bg-white/5 hover:border-white/20"
        >
          View Profile
        </Link>

        {isProvider ? (
          <Link
            href={`/dashboard?hire=${agent.id}`}
            className="flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-center text-xs font-semibold text-white shadow-[0_4px_20px_rgba(6,182,212,0.25)] transition hover:brightness-110"
          >
            Hire Agent
          </Link>
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-white/5 bg-white/[0.01] px-4 py-2 text-center text-xs text-white/30 cursor-default">
            No Action
          </div>
        )}
      </div>
    </div>
  )
}
