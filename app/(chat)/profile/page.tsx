'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { 
  ArrowLeft, 
  Award, 
  BadgeCheck, 
  Coins, 
  ExternalLink, 
  Fingerprint, 
  Mail, 
  MessageSquare, 
  Play,
  Shield, 
  User as UserIcon,
  Wallet,
  Clock,
  ChevronRight,
  Loader2,
  Activity
} from 'lucide-react'

import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'
import { toast } from '@/components/ui/toast'
import { TestResultModal } from '@/components/chat/TestResultModal'

type Profile = {
  notifyEmail: string | null
  telegramChatId: string | null
}

type Identity = {
  hasIdentity: boolean
  tokenId: string | null
  txHash: string | null
  mintedAt: string | null
}

type UserData = {
  id: string
  wallet: string
  credits: number
  reputationScore: number
  createdAt: string
  identity: Identity
  profile: Profile
}

type Deployment = {
  id: string
  workflowId: string
  workflowPrompt: string | null
  cronExpression: string
  status: 'active' | 'paused'
  createdAt: string
}

export default function ProfilePage() {
  const [user, setUser] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(true)
  const [deploymentsList, setDeploymentsList] = useState<Deployment[]>([])
  const [deploymentsLoading, setDeploymentsLoading] = useState(true)
  const [isTestModalOpen, setIsTestModalOpen] = useState(false)
  const [testDeploymentId, setTestDeploymentId] = useState('')
  const [testWorkflowTitle, setTestWorkflowTitle] = useState('')

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((data) => {
        // The /api/me response structure might need to be flattened or adjusted
        // based on how it returns reputationScore (which we saw in schema but
        // maybe not in route.ts yet).
        setUser(data)
      })
      .catch((err) => console.error('Failed to fetch user', err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/me/deployments')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setDeploymentsList(data)
      })
      .catch((err) => console.error('Failed to fetch deployments', err))
      .finally(() => setDeploymentsLoading(false))
  }, [])

  const handleToggleDeployment = async (deployId: string) => {
    const target = deploymentsList.find((d) => d.id === deployId)
    const willPause = target?.status === 'active'
    try {
      const res = await fetch(`/api/deployments/${deployId}`, {
        method: 'POST'
      })
      if (res.ok) {
        setDeploymentsList((prev) =>
          prev.map((d) =>
            d.id === deployId
              ? { ...d, status: d.status === 'active' ? 'paused' : 'active' }
              : d
          )
        )
        if (willPause) {
          toast.warning('Cron job paused', 'Hermes will not run this workflow until you resume it.')
        } else {
          toast.success('Cron job activated', 'Hermes will continue running the workflow according to the configured schedule.')
        }
      } else {
        toast.error('Unable to update', 'Please try again later.')
      }
    } catch (e) {
      console.error('Failed to toggle deployment status', e)
      toast.error('Connection error', 'Unable to connect to the server.')
    }
  }

  const handleDeleteDeployment = async (deployId: string) => {
    if (!confirm('Confirm deleting this deployment? Hermes will stop running the workflow on schedule.')) return
    try {
      const res = await fetch(`/api/deployments/${deployId}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        setDeploymentsList((prev) => prev.filter((d) => d.id !== deployId))
        toast.success('Deployment deleted', 'Cron job has been removed from Hermes.')
      } else {
        toast.error('Unable to delete', 'Please try again later.')
      }
    } catch (e) {
      console.error('Failed to delete deployment', e)
      toast.error('Connection error', 'Unable to connect to the server.')
    }
  }

  const handleTestDeployment = (deployId: string, workflowPrompt: string | null) => {
    setTestDeploymentId(deployId)
    setTestWorkflowTitle(workflowPrompt || `Workflow ${deployId.slice(0, 8)}`)
    setIsTestModalOpen(true)
  }

  const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

  return (
    <div className="giga-theme flex h-full w-full flex-col">
      <MainHeader />
      <div className="flex flex-1 overflow-hidden">
        <HistorySidebar />
        <AppRail />
        <main className="flex-1 overflow-y-auto bg-[#0f131c] p-4 sm:p-8">
          <div className="mx-auto w-full max-w-4xl">
            {/* Header with Back Button */}
            <div className="mb-8 flex items-center gap-4">
              <Link
                href="/"
                className="inline-flex h-10 w-10 items-center justify-center border-2 border-black bg-[var(--giga-panel)] text-white/70 transition-all hover:text-white hover:scale-105 active:scale-95"
                aria-label="Back"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="font-pixel-header text-2xl text-white sm:text-3xl">Agent Profile</h1>
                <p className="text-xs uppercase tracking-widest text-white/40">Identity & Reputation Management</p>
              </div>
            </div>

            {loading || !user ? (
              <div className="flex h-64 items-center justify-center border-2 border-black bg-[var(--giga-panel)] text-white/55">
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="h-8 w-8 animate-spin text-[var(--giga-accent)]" />
                  <p className="font-pixel-body text-sm">Syncing with Arc Network...</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Left Column: Avatar & Basic Info */}
                <div className="space-y-6 lg:col-span-1">
                  <div className="border-2 border-black bg-[var(--giga-panel)] p-6 flex flex-col items-center text-center">
                    <div className="relative mb-4">
                      <div className="pixel-border h-24 w-24 overflow-hidden bg-gray-800 shadow-[4px_4px_0_0_#000]">
                        <svg viewBox="0 0 40 40" width="100%" height="100%">
                          <rect fill="#3a3a5e" height="4" width="20" x="10" y="16" />
                          <rect fill="#3a3a5e" height="4" width="12" x="14" y="12" />
                          <rect fill="#3a3a5e" height="4" width="8" x="16" y="8" />
                          <rect fill="#fcdbb6" height="8" width="12" x="14" y="20" />
                          <rect fill="#000" height="2" width="2" x="16" y="22" />
                          <rect fill="#000" height="2" width="2" x="22" y="22" />
                          <rect fill="#fff" height="8" width="16" x="12" y="28" />
                        </svg>
                      </div>
                      {user.identity.hasIdentity && (
                        <div className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center bg-emerald-500 border-2 border-black shadow-[2px_2px_0_0_#000]" title="Verified Identity">
                          <BadgeCheck className="h-5 w-5 text-white" />
                        </div>
                      )}
                    </div>
                    
                    <h2 className="font-pixel-header text-xl text-white mb-1">
                      Agent #{user.id.slice(0, 4).toUpperCase()}
                    </h2>
                    <p className="font-mono text-[10px] text-white/40 break-all mb-4">
                      {user.wallet}
                    </p>

                    <div className="flex w-full flex-col gap-2">
                      <div className="flex items-center justify-between border border-white/5 bg-white/5 px-3 py-2">
                        <span className="text-[10px] uppercase text-white/40">Status</span>
                        <span className="text-[10px] uppercase text-emerald-400 font-bold">Active</span>
                      </div>
                      <div className="flex items-center justify-between border border-white/5 bg-white/5 px-3 py-2">
                        <span className="text-[10px] uppercase text-white/40">Joined</span>
                        <span className="text-[10px] uppercase text-white/70">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Reputation Box */}
                  <div className="border-2 border-black bg-[var(--giga-panel)] p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-pixel-body text-xs uppercase tracking-tighter text-[var(--giga-accent)]">On-chain Reputation</h3>
                      <Award className="h-4 w-4 text-[var(--giga-accent)]" />
                    </div>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-4xl font-pixel-header text-white leading-none">{user.reputationScore || 0}</span>
                      <span className="text-xs text-white/40 uppercase">Points</span>
                    </div>
                    <div className="h-2 w-full bg-black/40 border border-white/10 p-0.5 mb-4">
                      <div 
                        className="h-full bg-gradient-to-r from-purple-500 to-cyan-400" 
                        style={{ width: `${Math.min(100, ((user.reputationScore || 0) % 100))}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-white/50 leading-relaxed">
                      Reputation is earned by successfully completing workflows. High reputation grants priority dispatch and early access to experimental skills.
                    </p>
                  </div>
                </div>

                {/* Right Column: Cards & Details */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Credits & Identity Grid */}
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    {/* Credits Card */}
                    <div className="border-2 border-black bg-[var(--giga-panel)] p-6 group hover:border-[var(--giga-accent)] transition-colors">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex h-10 w-10 items-center justify-center bg-cyan-500/20 text-cyan-400 border border-cyan-500/40">
                          <Coins className="h-6 w-6" />
                        </div>
                        <Link href="/finance" className="text-[10px] uppercase text-cyan-300 hover:underline flex items-center gap-1">
                          Top-up <ChevronRight className="h-3 w-3" />
                        </Link>
                      </div>
                      <div className="text-2xl font-pixel-header text-white mb-1">
                        {user.credits.toLocaleString()} <span className="text-sm text-white/40 uppercase">Credits</span>
                      </div>
                      <p className="text-[11px] text-white/40">≈ ${(user.credits / 100).toFixed(2)} USDC Available</p>
                    </div>

                    {/* Identity Card */}
                    <div className="border-2 border-black bg-[var(--giga-panel)] p-6 group hover:border-purple-500/60 transition-colors">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex h-10 w-10 items-center justify-center bg-purple-500/20 text-purple-400 border border-purple-500/40">
                          <Fingerprint className="h-6 w-6" />
                        </div>
                        {user.identity.hasIdentity && (
                          <span className="text-[10px] uppercase text-emerald-400 font-bold">Verified</span>
                        )}
                      </div>
                      {user.identity.hasIdentity ? (
                        <div>
                          <div className="text-sm font-mono text-purple-200 mb-1">Token #{user.identity.tokenId}</div>
                          <a 
                            href={`${EXPLORER}/tx/${user.identity.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-white/40 hover:text-white flex items-center gap-1 truncate"
                          >
                            TX: {user.identity.txHash?.slice(0, 16)}... <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </div>
                      ) : (
                        <div>
                          <div className="text-sm text-white/70 mb-1">No Identity Minted</div>
                          <button className="text-[10px] uppercase text-[var(--giga-accent)] hover:underline">
                            Mint ERC-8004 Identity
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Active Deployments */}
                  <div className="border-2 border-black bg-[var(--giga-panel)] p-6">
                    <h3 className="font-pixel-body text-xs uppercase tracking-widest text-[var(--giga-accent)] mb-6 flex items-center gap-2">
                      <Activity className="h-4 w-4" /> Active Deployments (Hermes Cron)
                    </h3>

                    {deploymentsLoading ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin text-[var(--giga-accent)]" />
                      </div>
                    ) : deploymentsList.length === 0 ? (
                      <div className="text-center py-6 border border-dashed border-white/10 bg-black/10">
                        <p className="font-pixel-body text-[10px] text-white/40 uppercase">
                          No active deployments
                        </p>
                        <p className="text-[10px] text-white/30 font-pixel-body mt-1">
                          Deploy a completed workflow to schedule automations
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {deploymentsList.map((d) => (
                          <div key={d.id} className="flex flex-col sm:flex-row sm:items-center justify-between border border-white/10 bg-black/20 p-4 gap-4">
                            <div className="flex-1 min-w-0">
                              <Link 
                                href={`/workflow/${d.workflowId}`} 
                                className="font-pixel-body text-xs text-white hover:text-[var(--giga-accent)] hover:underline transition truncate block uppercase"
                              >
                                {d.workflowPrompt || `Workflow ${d.workflowId.slice(0, 8)}`}
                              </Link>
                              <div className="flex flex-wrap items-center gap-2 mt-1.5 font-mono text-[9px] text-white/40">
                                <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5 text-[var(--giga-accent)]" /> {getCronDescription(d.cronExpression)}</span>
                                <span>•</span>
                                <span>Status:</span>
                                <span className={`inline-flex px-1.5 py-0.5 text-[8px] font-pixel-body border uppercase font-bold select-none ${
                                  d.status === 'active' 
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' 
                                    : 'border-white/10 bg-white/5 text-white/40'
                                }`}>
                                  {d.status}
                                </span>
                                <span>•</span>
                                <span>Created: {new Date(d.createdAt).toLocaleDateString()}</span>
                              </div>
                            </div>
                            <div className="flex gap-2 shrink-0 self-end sm:self-center">
                              <button
                                type="button"
                                onClick={() => handleTestDeployment(d.id, d.workflowPrompt)}
                                className="px-3 py-1.5 font-pixel-body text-[10px] uppercase border border-cyan-500/20 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition active:scale-95 cursor-pointer flex items-center gap-1"
                              >
                                <Play className="h-2.5 w-2.5" /> TEST
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleDeployment(d.id)}
                                className={`px-3 py-1.5 font-pixel-body text-[10px] uppercase border transition active:scale-95 cursor-pointer ${
                                  d.status === 'active'
                                    ? 'border-yellow-500/20 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20'
                                    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                }`}
                              >
                                {d.status === 'active' ? 'PAUSE' : 'RESUME'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteDeployment(d.id)}
                                className="px-3 py-1.5 font-pixel-body text-[10px] uppercase border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition active:scale-95 cursor-pointer"
                              >
                                DELETE
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Connected Accounts */}
                  <div className="border-2 border-black bg-[var(--giga-panel)] p-6">
                    <h3 className="font-pixel-body text-xs uppercase tracking-widest text-white/60 mb-6 flex items-center gap-2">
                      <Shield className="h-4 w-4" /> Connected Channels
                    </h3>
                    
                    <div className="space-y-4">
                      {/* Email Channel */}
                      <div className="flex items-center justify-between border border-white/10 bg-black/20 p-4">
                        <div className="flex items-center gap-4">
                          <div className="flex h-10 w-10 items-center justify-center bg-pink-500/20 text-pink-400">
                            <Mail className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">Email (Resend)</div>
                            <div className="text-xs text-white/40">
                              {user.profile.notifyEmail || 'No email configured'}
                            </div>
                          </div>
                        </div>
                        <Link href="/settings" className="h-8 w-8 flex items-center justify-center border border-white/20 hover:bg-white/10 text-white/40 hover:text-white">
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </div>

                      {/* Telegram Channel */}
                      <div className="flex items-center justify-between border border-white/10 bg-black/20 p-4">
                        <div className="flex items-center gap-4">
                          <div className="flex h-10 w-10 items-center justify-center bg-blue-500/20 text-blue-400">
                            <MessageSquare className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">Telegram Bot</div>
                            <div className="text-xs text-white/40">
                              {user.profile.telegramChatId ? `ID: ${user.profile.telegramChatId}` : 'No bot linked'}
                            </div>
                          </div>
                        </div>
                        <Link href="/settings" className="h-8 w-8 flex items-center justify-center border border-white/20 hover:bg-white/10 text-white/40 hover:text-white">
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* Activity Stats Footer */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="border-2 border-black bg-[var(--giga-panel)] p-4 flex items-center gap-3">
                      <div className="h-8 w-8 flex items-center justify-center bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <Clock className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-white/40">Total Tasks</div>
                        <div className="text-sm font-pixel-header text-white">128</div>
                      </div>
                    </div>
                    <div className="border-2 border-black bg-[var(--giga-panel)] p-4 flex items-center gap-3">
                      <div className="h-8 w-8 flex items-center justify-center bg-purple-500/10 text-purple-400 border border-purple-500/20">
                        <UserIcon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-white/40">Skill Rank</div>
                        <div className="text-sm font-pixel-header text-white">Gold</div>
                      </div>
                    </div>
                    <div className="border-2 border-black bg-[var(--giga-panel)] p-4 flex items-center gap-3">
                      <div className="h-8 w-8 flex items-center justify-center bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        <Wallet className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-white/40">Wallet Rank</div>
                        <div className="text-sm font-pixel-header text-white">Whale</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
      <TestResultModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        deploymentId={testDeploymentId}
        workflowTitle={testWorkflowTitle}
      />
    </div>
  )
}

function getCronDescription(cron: string) {
  if (cron === '*/10 * * * *') return 'Every 10 mins'
  if (cron === '*/30 * * * *') return 'Every 30 mins'
  if (cron === '0 * * * *') return 'Every hour'
  if (cron === '0 */6 * * *') return 'Every 6 hours'
  if (cron === '0 0 * * *') return 'Every day'
  return cron
}
