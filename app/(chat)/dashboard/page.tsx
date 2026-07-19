'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MainHeader } from '@/components/shell/MainHeader'
import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { JobBoard } from '@/components/agent/JobBoard'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { LayoutDashboard, Loader2, Cpu, Briefcase, Wallet, PlusCircle } from 'lucide-react'
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
  reputationScore: string | null
}

interface Job {
  id: string
  clientAgentId: string | null
  providerAgentId: string | null
  status: string | null
  budgetUsdc: string | null
  description: string | null
  createdAt: string | Date | null
}

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeWallet = useActiveWallet()
  const hireProviderId = searchParams.get('hire')

  const [myAgents, setMyAgents] = useState<Agent[]>([])
  const [allProviders, setAllProviders] = useState<Agent[]>([])
  const [myJobs, setMyJobs] = useState<Job[]>([])
  const [agentsMap, setAgentsMap] = useState<Record<string, { name: string }>>({})
  
  const [loading, setLoading] = useState(true)

  // Create Job Form State
  const [clientAgentId, setClientAgentId] = useState('')
  const [providerAgentId, setProviderAgentId] = useState(hireProviderId ?? '')
  const [budgetUsdc, setBudgetUsdc] = useState('0.05')
  const [description, setDescription] = useState('')
  const [creatingJob, setCreatingJob] = useState(false)
  const [formError, setFormError] = useState('')

  const [prevHireProviderId, setPrevHireProviderId] = useState(hireProviderId)
  if (hireProviderId !== prevHireProviderId) {
    setPrevHireProviderId(hireProviderId)
    setProviderAgentId(hireProviderId ?? '')
  }

  useEffect(() => {
    if (!activeWallet?.address) {
      Promise.resolve().then(() => setLoading(false))
      return
    }

    let active = true
    const fetchDashboardData = async () => {
      try {
        const userAddr = activeWallet.address.toLowerCase()
        
        // 1. Fetch all agents
        const resAgents = await fetch('/api/agents')
        const dataAgents = await resAgents.json()
        
        if (resAgents.ok && active) {
          const list: Agent[] = dataAgents.agents
          
          // Map agents by ID for fast lookup in job list
          const mapping: Record<string, { name: string }> = {}
          list.forEach((a) => {
            if (a.name) mapping[a.id] = { name: a.name }
          })
          setAgentsMap(mapping)

          // Filter user's agents
          const filteredMyAgents = list.filter((a) => a.ownerAddress.toLowerCase() === userAddr)
          setMyAgents(filteredMyAgents)

          // Filter all providers (excluding ones user owns, or all)
          const providers = list.filter((a) => a.agentType === 'provider')
          setAllProviders(providers)

          // Auto-select first client agent if available
          const firstClient = filteredMyAgents.find((a) => a.agentType === 'client')
          if (firstClient) {
            setClientAgentId(firstClient.id)
          }
        }

        // 2. Fetch all jobs
        const resJobs = await fetch('/api/jobs')
        if (resJobs.ok && active) {
          const dataJobs = await resJobs.json()
          setMyJobs(dataJobs.jobs || [])
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (active) setLoading(false)
      }
    }

    fetchDashboardData()
    return () => {
      active = false
    }
  }, [activeWallet?.address])

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientAgentId || !providerAgentId || !budgetUsdc) {
      setFormError('Please fill out all required fields')
      return
    }

    setCreatingJob(true)
    setFormError('')

    try {
      const res = await fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientAgentId,
          providerAgentId,
          budgetUsdc,
          description,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create job')
      }

      // Redirect to the negotiation room for this job!
      router.push(`/job/${data.job.id}`)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong')
      setCreatingJob(false)
    }
  }

  return (
    <>
      <MainHeader />
      <div className="flex h-[calc(100dvh-53px)] w-full overflow-hidden">
        <AppRail />
        <HistorySidebar />
        <main className="flex-1 overflow-y-auto bg-[#0f131c] p-6 sm:p-8">
          <div className="mx-auto w-full max-w-6xl space-y-8">
            
            {/* Header */}
            <div>
              <h1 className="text-3xl font-extrabold text-white flex items-center gap-2">
                <LayoutDashboard className="h-7 w-7 text-cyan-400" />
                <span>Agent Dashboard</span>
              </h1>
              <p className="text-sm text-white/50">Manage your Client and Provider agents, active escrows, and jobs</p>
            </div>

            {!activeWallet?.address ? (
              <div className="text-center py-20 rounded-2xl border border-dashed border-white/10 bg-white/[0.01]">
                <Wallet className="mx-auto h-10 w-10 text-white/20 mb-3" />
                <h3 className="text-sm font-medium text-white/75">Connect your Wallet</h3>
                <p className="text-xs text-white/40 mt-1">Please connect your owner wallet via the top header to access your dashboard.</p>
              </div>
            ) : loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
                <span className="text-sm text-white/40">Loading your dashboard...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Left Columns: My Agents & Hire Form */}
                <div className="lg:col-span-2 space-y-6">
                  
                  {/* My Agents */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-md space-y-4">
                    <h3 className="font-semibold text-white">My Registered Agents</h3>
                    
                    {myAgents.length === 0 ? (
                      <div className="text-center py-8 border border-dashed border-white/5 rounded-xl">
                        <p className="text-sm text-white/40">You don&apos;t own any registered agents yet.</p>
                        <Link href="/" className="mt-3 inline-block rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-1.5 text-xs font-semibold text-white">
                          Register an Agent
                        </Link>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {myAgents.map((agent) => (
                          <div
                            key={agent.id}
                            className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.02] transition"
                          >
                            <div className="flex items-center gap-3">
                              <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
                                agent.agentType === 'provider'
                                  ? 'border-cyan-500/30 bg-cyan-500/5 text-cyan-400'
                                  : 'border-purple-500/30 bg-purple-500/5 text-purple-400'
                              }`}>
                                {agent.agentType === 'provider' ? <Cpu className="h-4.5 w-4.5" /> : <Briefcase className="h-4.5 w-4.5" />}
                              </div>
                              <div>
                                <h4 className="text-sm font-semibold text-white">{agent.name}</h4>
                                <span className="text-[10px] text-white/40 uppercase">{agent.agentType}</span>
                              </div>
                            </div>

                            <Link
                              href={`/agent/${agent.id}`}
                              className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/85 hover:bg-white/5"
                            >
                              Manage
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Escrow Jobs */}
                  <JobBoard jobs={myJobs} agents={agentsMap} />
                </div>

                {/* Right Column: Hire/Create Job Form */}
                <div className="lg:col-span-1">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-md space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <PlusCircle className="h-5 w-5 text-cyan-400" />
                      <h3 className="font-semibold text-white">Start New Contract</h3>
                    </div>

                    <form onSubmit={handleCreateJob} className="space-y-4">
                      {/* Client Agent Selection */}
                      <div>
                        <label className="block text-[10px] text-white/40 uppercase mb-1">My Client Agent</label>
                        <select
                          value={clientAgentId}
                          onChange={(e) => setClientAgentId(e.target.value)}
                          required
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white focus:outline-none"
                        >
                          <option value="" className="bg-[#0f131c]">Select Client Agent...</option>
                          {myAgents
                            .filter((a) => a.agentType === 'client')
                            .map((a) => (
                              <option key={a.id} value={a.id} className="bg-[#0f131c]">
                                {a.name}
                              </option>
                            ))}
                        </select>
                      </div>

                      {/* Provider Agent Selection */}
                      <div>
                        <label className="block text-[10px] text-white/40 uppercase mb-1">Provider Agent to Hire</label>
                        <select
                          value={providerAgentId}
                          onChange={(e) => setProviderAgentId(e.target.value)}
                          required
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white focus:outline-none"
                        >
                          <option value="" className="bg-[#0f131c]">Select Provider...</option>
                          {allProviders.map((a) => (
                            <option key={a.id} value={a.id} className="bg-[#0f131c]">
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Budget */}
                      <div>
                        <label className="block text-[10px] text-white/40 uppercase mb-1">Initial Budget (USDC)</label>
                        <input
                          type="number"
                          step="any"
                          value={budgetUsdc}
                          onChange={(e) => setBudgetUsdc(e.target.value)}
                          required
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 font-mono text-xs text-white placeholder-white/30 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block text-[10px] text-white/40 uppercase mb-1">Job Description</label>
                        <textarea
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="What needs to be done..."
                          required
                          className="w-full h-20 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-white focus:border-cyan-500 focus:outline-none resize-none"
                        />
                      </div>

                      {formError && <p className="text-xs text-red-400">{formError}</p>}

                      <button
                        type="submit"
                        disabled={creatingJob}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-cyan-500 text-black py-2.5 text-xs font-semibold hover:bg-cyan-400 disabled:opacity-50 transition"
                      >
                        {creatingJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>Open Negotiation</span>}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#0f131c] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
        <span className="text-sm text-white/40">Loading Dashboard...</span>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  )
}
