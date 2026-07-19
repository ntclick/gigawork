'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { MainHeader } from '@/components/shell/MainHeader'
import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { ChatNegotiate } from '@/components/agent/ChatNegotiate'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import {
  Briefcase,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import Link from 'next/link'

interface Agent {
  id: string
  ownerAddress: string
  name: string
  walletAddress: string
  onchainId: string | null
}

interface Job {
  id: string
  onchainJobId: string | null
  clientAgentId: string | null
  providerAgentId: string | null
  status: string | null // 'Open' | 'Funded' | 'Submitted' | 'Completed'
  budgetUsdc: string | null
  description: string | null
  deliverableHash: string | null
  client: Agent | null
  provider: Agent | null
}

interface ChatMessage {
  id: string
  jobId: string | null
  agentId: string | null
  role: string | null
  message: string | null
  priceOffer: string | null
  createdAt: Date | null
  agentName: string | null
  agentWallet: string | null
}

export default function JobRoomPage() {
  const params = useParams()
  const id = params.id as string
  const activeWallet = useActiveWallet()

  const [job, setJob] = useState<Job | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')

  const [prevId, setPrevId] = useState(id)
  if (id !== prevId) {
    setPrevId(id)
    setLoading(true)
  }

  // Form inputs for completion
  const [rating, setRating] = useState('5')
  const [comment, setComment] = useState('Excellent delivery.')

  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const refreshRoom = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1)
  }, [])

  useEffect(() => {
    if (!id) return
    let active = true

    const fetchRoomData = async () => {
      try {
        const res = await fetch(`/api/negotiate/${id}`)
        const msgData = await res.json()
        if (res.ok && active) {
          setMessages(msgData.messages || [])
        }
      } catch (err) {
        console.error(err)
      }
    }

    const fetchJobDetails = async () => {
      try {
        const res = await fetch(`/api/jobs/${id}`)
        if (res.ok && active) {
          const data = await res.json()
          setJob(data.job)
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (active) setLoading(false)
      }
    }

    fetchJobDetails()
    fetchRoomData()

    return () => {
      active = false
    }
  }, [id, refreshTrigger])

  const handleFund = async () => {
    setActionLoading(true)
    setActionError('')
    setActionSuccess('')
    try {
      const res = await fetch(`/api/jobs/${id}/fund`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fund escrow')
      setActionSuccess('Escrow funded successfully on-chain!')
      refreshRoom()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Funding failed')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSubmitDeliverable = async () => {
    setActionLoading(true)
    setActionError('')
    setActionSuccess('')
    try {
      const res = await fetch(`/api/jobs/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverableSeed: `deliverable-${id}-${Date.now()}` }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to submit deliverable')
      setActionSuccess('Deliverable submitted successfully on-chain!')
      refreshRoom()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setActionLoading(false)
    }
  }

  const handleComplete = async () => {
    setActionLoading(true)
    setActionError('')
    setActionSuccess('')
    try {
      const res = await fetch(`/api/jobs/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: parseInt(rating), comment }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to complete job')
      setActionSuccess('Job completed, USDC released, and reputation updated on-chain!')
      refreshRoom()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Completion failed')
    } finally {
      setActionLoading(false)
    }
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
            <span className="text-sm text-white/40">Entering negotiation room...</span>
          </div>
        </div>
      </>
    )
  }

  if (!job) {
    return (
      <>
        <MainHeader />
        <div className="flex h-[calc(100dvh-53px)] w-full overflow-hidden">
          <AppRail />
          <HistorySidebar />
          <div className="flex-1 flex flex-col items-center justify-center bg-[#0f131c] gap-3 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500" />
            <h2 className="text-lg font-bold text-white">Negotiation Room Not Found</h2>
            <p className="text-sm text-white/40 max-w-sm">This job may have been deleted or archived.</p>
            <Link href="/" className="mt-4 rounded-xl bg-white text-black px-4 py-2 text-xs font-semibold">
              Back to Marketplace
            </Link>
          </div>
        </div>
      </>
    )
  }

  const userAddress = activeWallet?.address?.toLowerCase() || ''
  const isClientOwner = userAddress === job.client?.ownerAddress?.toLowerCase()
  const isProviderOwner = userAddress === job.provider?.ownerAddress?.toLowerCase()

  const activeAgentId = isClientOwner
    ? job.clientAgentId || ''
    : isProviderOwner
    ? job.providerAgentId || ''
    : ''
  const activeRole = isClientOwner ? 'client' : 'provider'

  const agentsMap = {
    [job.clientAgentId || '']: { name: job.client?.name || 'Client', walletAddress: job.client?.walletAddress || '' },
    [job.providerAgentId || '']: { name: job.provider?.name || 'Provider', walletAddress: job.provider?.walletAddress || '' },
  }

  return (
    <>
      <MainHeader />
      <div className="flex h-[calc(100dvh-53px)] w-full overflow-hidden">
        <AppRail />
        <HistorySidebar />
        <main className="flex-1 overflow-y-auto bg-[#0f131c] p-6 sm:p-8">
          <div className="mx-auto w-full max-w-6xl space-y-6">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-5">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-cyan-400" />
                  <h2 className="text-xl font-bold text-white">Negotiation & Escrow Room</h2>
                </div>
                <p className="text-xs text-white/50">{job.description}</p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40">Status:</span>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase ${
                  job.status === 'Completed'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : job.status === 'Submitted'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : job.status === 'Funded'
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                    : 'border-white/10 bg-white/5 text-white/50'
                }`}>
                  {job.status ?? 'Open'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Chat Negotiation */}
              <div className="lg:col-span-2 space-y-6">
                {activeAgentId ? (
                  <ChatNegotiate
                    jobId={job.id}
                    activeAgentId={activeAgentId}
                    activeRole={activeRole}
                    initialMessages={messages}
                    agents={agentsMap}
                  />
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.01] p-12 text-center space-y-3">
                    <AlertTriangle className="mx-auto h-8 w-8 text-white/20" />
                    <h4 className="text-sm font-semibold text-white/70">Read-Only Access</h4>
                    <p className="text-xs text-white/40 max-w-sm mx-auto">
                      You are viewing this room as an observer. Only the owners of the client agent ({job.client?.name}) or provider agent ({job.provider?.name}) can send messages.
                    </p>
                  </div>
                )}
              </div>

              {/* Right Column: Escrow Panel & Actions */}
              <div className="lg:col-span-1 space-y-6">
                
                {/* Escrow Details */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-md space-y-4">
                  <h3 className="font-semibold text-white">Escrow Contract</h3>
                  
                  <div className="space-y-3 font-mono text-xs">
                    <div className="flex justify-between py-1.5 border-b border-white/5">
                      <span className="text-white/40">On-chain Job ID</span>
                      <span className="text-white">{job.onchainJobId?.toString() || 'Unassigned'}</span>
                    </div>

                    <div className="flex justify-between py-1.5 border-b border-white/5">
                      <span className="text-white/40">Budget</span>
                      <span className="text-cyan-300 font-bold">${Number(job.budgetUsdc || 0).toFixed(2)} USDC</span>
                    </div>

                    <div className="space-y-1">
                      <span className="text-white/40 block">Client Agent Address</span>
                      <span className="text-white/80 font-mono text-[10px] bg-white/[0.02] px-2 py-1.5 rounded block overflow-x-auto whitespace-nowrap scrollbar-none">{job.client?.walletAddress || 'None'}</span>
                    </div>

                    <div className="space-y-1">
                      <span className="text-white/40 block">Provider Agent Address</span>
                      <span className="text-white/80 font-mono text-[10px] bg-white/[0.02] px-2 py-1.5 rounded block overflow-x-auto whitespace-nowrap scrollbar-none">{job.provider?.walletAddress || 'None'}</span>
                    </div>
                  </div>
                </div>

                {/* Role Actions */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-md space-y-4">
                  <h3 className="font-semibold text-white">Agent Actions</h3>

                  {actionError && <p className="text-xs text-red-400">{actionError}</p>}
                  {actionSuccess && <p className="text-xs text-emerald-400">{actionSuccess}</p>}

                  {/* Funding (Client Role) */}
                  {job.status === 'Open' && (
                    <div className="space-y-3">
                      <p className="text-xs text-white/50">
                        Escrow negotiation is complete. As the owner of the client agent, you must fund the escrow to lock the USDC in the contract.
                      </p>
                      <button
                        onClick={handleFund}
                        disabled={actionLoading || !isClientOwner}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 py-2.5 text-xs font-semibold text-white shadow-[0_4px_15px_rgba(6,182,212,0.2)] hover:brightness-110 disabled:opacity-50 transition"
                      >
                        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>Fund On-chain Escrow</span>}
                      </button>
                    </div>
                  )}

                  {/* Submission (Provider Role) */}
                  {job.status === 'Funded' && (
                    <div className="space-y-3">
                      <p className="text-xs text-white/50">
                        USDC is successfully locked on-chain. As the owner of the provider agent, execute the work deliverable upload.
                      </p>
                      <button
                        onClick={handleSubmitDeliverable}
                        disabled={actionLoading || !isProviderOwner}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-2.5 text-xs font-semibold text-white shadow-[0_4px_15px_rgba(245,158,11,0.2)] hover:brightness-110 disabled:opacity-50 transition"
                      >
                        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>Submit Deliverables</span>}
                      </button>
                    </div>
                  )}

                  {/* Completion (Client Role) */}
                  {job.status === 'Submitted' && (
                    <div className="space-y-4">
                      <p className="text-xs text-white/50">
                        Deliverable has been signed off on-chain. As the client, finalize the job to release the locked USDC and submit reputation score.
                      </p>

                      <div className="space-y-3 border-t border-white/5 pt-3">
                        <div>
                          <label className="block text-[10px] text-white/40 uppercase mb-1">Rating (1-5)</label>
                          <select
                            value={rating}
                            onChange={(e) => setRating(e.target.value)}
                            disabled={actionLoading || !isClientOwner}
                            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white focus:outline-none"
                          >
                            <option value="5" className="bg-[#0f131c]">5 - Excellent</option>
                            <option value="4" className="bg-[#0f131c]">4 - Good</option>
                            <option value="3" className="bg-[#0f131c]">3 - Satisfactory</option>
                            <option value="2" className="bg-[#0f131c]">2 - Poor</option>
                            <option value="1" className="bg-[#0f131c]">1 - Very Poor</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] text-white/40 uppercase mb-1">Feedback Comment</label>
                          <textarea
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            disabled={actionLoading || !isClientOwner}
                            placeholder="Add brief feedback..."
                            className="w-full h-16 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white focus:outline-none resize-none"
                          />
                        </div>

                        <button
                          onClick={handleComplete}
                          disabled={actionLoading || !isClientOwner}
                          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 py-2.5 text-xs font-semibold text-white shadow-[0_4px_15px_rgba(16,185,129,0.2)] hover:brightness-110 disabled:opacity-50 transition"
                        >
                          {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>Release Escrow & Rate</span>}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Completed State */}
                  {job.status === 'Completed' && (
                    <div className="flex flex-col items-center justify-center py-4 text-center gap-2 text-emerald-400">
                      <CheckCircle2 className="h-8 w-8" />
                      <span className="text-xs font-bold uppercase tracking-wider">Escrow Fully Settled</span>
                      <p className="text-[10px] text-white/40">USDC released to provider and feedback logged on-chain.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  )
}
