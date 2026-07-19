'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { MainHeader } from '@/components/shell/MainHeader'
import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { WalletPanel } from '@/components/agent/WalletPanel'
import { ReputationBadge } from '@/components/agent/ReputationBadge'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { ArrowLeft, Cpu, Briefcase, Shield, ShieldAlert, Loader2, Link2, Copy, Check } from 'lucide-react'
import Link from 'next/link'

interface Agent {
  id: string
  onchainId: string | null
  ownerAddress: string
  agentType: string | null
  name: string | null
  description: string | null
  capabilities: string[] | null
  walletAddress: string | null
  metadataUri: string | null
  reputationScore: string | null
  isActive: boolean | null
}

export default function AgentProfilePage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const activeWallet = useActiveWallet()
  
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<Record<string, boolean>>({})

  const fetchAgentDetails = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/agents')
      const data = await res.json()
      if (res.ok) {
        const found = data.agents.find((a: Agent) => a.id === id)
        setAgent(found || null)
      }
    } catch (err) {
      console.error('Failed to fetch agent details:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (id) {
      fetchAgentDetails()
    }
  }, [id])

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied((prev) => ({ ...prev, [key]: true }))
    setTimeout(() => {
      setCopied((prev) => ({ ...prev, [key]: false }))
    }, 2000)
  }

  if (loading) {
    return (
      <>
        <MainHeader />
        <div className="flex h-[calc(100dvh-53px)] w-full overflow-hidden">
          <AppRail />
          <HistorySidebar />
          <div className="flex-1 flex flex-col items-center justify-center bg-[#0f131c] gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
            <span className="text-sm text-white/40">Loading profile...</span>
          </div>
        </div>
      </>
    )
  }

  if (!agent) {
    return (
      <>
        <MainHeader />
        <div className="flex h-[calc(100dvh-53px)] w-full overflow-hidden">
          <AppRail />
          <HistorySidebar />
          <div className="flex-1 flex flex-col items-center justify-center bg-[#0f131c] gap-3 p-6 text-center">
            <ShieldAlert className="h-10 w-10 text-red-400" />
            <h2 className="text-lg font-bold text-white">Agent Profile Not Found</h2>
            <p className="text-sm text-white/40 max-w-sm mt-1">
              We couldn't locate this agent in our registry. They may have been deactivated.
            </p>
            <Link
              href="/"
              className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10 transition"
            >
              Back to Marketplace
            </Link>
          </div>
        </div>
      </>
    )
  }

  const isProvider = agent.agentType === 'provider'
  const isOwner = activeWallet?.address?.toLowerCase() === agent.ownerAddress.toLowerCase()

  return (
    <>
      <MainHeader />
      <div className="flex h-[calc(100dvh-53px)] w-full overflow-hidden">
        <AppRail />
        <HistorySidebar />
        <main className="flex-1 overflow-y-auto bg-[#0f131c] p-6 sm:p-8">
          <div className="mx-auto w-full max-w-5xl space-y-6">
            
            {/* Back Button */}
            <button
              onClick={() => router.back()}
              className="flex items-center gap-1.5 text-xs text-white/55 hover:text-white transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back</span>
            </button>

            {/* Profile Overview Header */}
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-8 backdrop-blur-md">
              <div className="absolute -inset-px bg-gradient-to-r from-cyan-500/5 via-cyan-500/0 to-cyan-500/0 rounded-2xl -z-10" />

              <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                <div className="flex items-start gap-4">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${
                    isProvider 
                      ? 'border-cyan-500/30 bg-cyan-500/5 text-cyan-400' 
                      : 'border-purple-500/30 bg-purple-500/5 text-purple-400'
                  }`}>
                    {isProvider ? <Cpu className="h-7 w-7" /> : <Briefcase className="h-7 w-7" />}
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-2xl font-bold text-white">{agent.name}</h2>
                    
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border ${
                        isProvider
                          ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                          : 'border-purple-500/30 bg-purple-500/10 text-purple-300'
                      }`}>
                        {agent.agentType}
                      </span>
                      
                      {agent.onchainId && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] text-white/60">
                          NFT ID: #{agent.onchainId.toString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Scorecard */}
                <div className="rounded-xl border border-white/5 bg-white/[0.01] px-5 py-3.5 min-w-[200px]">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Attestation Score</span>
                  <ReputationBadge score={Number(agent.reputationScore ?? '0')} />
                </div>
              </div>

              {/* Description */}
              <div className="mt-8 border-t border-white/5 pt-6 space-y-2">
                <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider">About Agent</h4>
                <p className="text-sm text-white/80 leading-relaxed max-w-3xl">
                  {agent.description || 'No description provided.'}
                </p>
              </div>
            </div>

            {/* Main Content Details Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: Stats & Meta */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Capabilities */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-md space-y-4">
                  <h3 className="font-semibold text-white">Capabilities & APIs</h3>
                  
                  <div className="flex flex-wrap gap-2">
                    {(agent.capabilities ?? []).map((cap, i) => (
                      <span
                        key={i}
                        className="rounded-xl border border-white/5 bg-white/[0.03] px-3.5 py-1.5 text-xs text-white/85"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>

                {/* On-chain Details */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-md space-y-4">
                  <h3 className="font-semibold text-white">On-chain Binding</h3>
                  
                  <div className="space-y-3.5">
                    {/* Wallet Address */}
                    {agent.walletAddress && (
                      <div className="flex items-center justify-between text-xs py-2 border-b border-white/5">
                        <span className="text-white/45">Agent EVM Address</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-white/85">{agent.walletAddress}</span>
                          <button
                            onClick={() => copyToClipboard(agent.walletAddress!, 'wallet')}
                            className="text-white/40 hover:text-white/80 transition p-1 rounded hover:bg-white/5"
                          >
                            {copied.wallet ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Owner Address */}
                    <div className="flex items-center justify-between text-xs py-2 border-b border-white/5">
                      <span className="text-white/45">Owner Address</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-white/85">{agent.ownerAddress}</span>
                        <button
                          onClick={() => copyToClipboard(agent.ownerAddress, 'owner')}
                          className="text-white/40 hover:text-white/80 transition p-1 rounded hover:bg-white/5"
                        >
                          {copied.owner ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Metadata URI */}
                    {agent.metadataUri && (
                      <div className="flex items-center justify-between text-xs py-2">
                        <span className="text-white/45">ERC-8004 IPFS Metadata</span>
                        <div className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300">
                          <Link2 className="h-3.5 w-3.5" />
                          <a
                            href={agent.metadataUri.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/')}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono underline"
                          >
                            View IPFS Metadata
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Wallet & Withdrawal Panel */}
              <div className="lg:col-span-1">
                <WalletPanel agentId={agent.id} ownerAddress={agent.ownerAddress} />
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  )
}
