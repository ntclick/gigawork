'use client'

import { useEffect, useState, useCallback } from 'react'
import { MainHeader } from '@/components/shell/MainHeader'
import { Button } from '@/components/ui/button'
import {
  ShieldCheck,
  Users,
  Coins,
  Cpu,
  Activity,
  Orbit,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  Clock,
  ArrowRightLeft,
} from 'lucide-react'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'

interface SystemStats {
  totalUsers: number
  totalCredits: number
  totalWorkflows: number
  completedWorkflows: number
  totalUSDCVolume: string
  totalSkills: number
  activeDeployments: number
  totalRaffles: number
  completedRaffles: number
  spaceComputerStatus: string
  spaceComputerDetail: string
  totalNanopaymentCalls?: number
  totalNanopaymentRevenue?: string
}

interface RecentActivity {
  id: string
  reason: string
  delta: number
  createdAt: string
  userWallet?: string | null
}

interface RecentNanopayment {
  id: string
  skillName: string
  amountUsdc: string
  buyerAddress: string
  status: string
  createdAt: string
}

export default function AdminConsolePage() {
  const activeWallet = useActiveWallet()
  const isAdmin = activeWallet?.address?.toLowerCase() === '0xafe6dd950dc2cf561e8daba1725e0e6840f70549'

  const [stats, setStats] = useState<SystemStats | null>(null)
  const [activity, setActivity] = useState<RecentActivity[]>([])
  const [recentNanopayments, setRecentNanopayments] = useState<RecentNanopayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string>('')

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/system-stats', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to query global statistics.')
      }
      setStats(json.stats)
      setActivity(json.recentActivity || [])
      setRecentNanopayments(json.recentNanopayments || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse GigaWork system data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) {
      const t = setTimeout(() => {
        fetchStats()
      }, 0)
      return () => clearTimeout(t)
    }
  }, [isAdmin, fetchStats])

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(''), 2000)
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0a0d14] text-white">
      {/* GigaWork standard main header */}
      <MainHeader />

      {/* Content wrapper */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!activeWallet ? (
          <div className="max-w-md mx-auto mt-24 p-6 border border-white/5 bg-slate-950/40 rounded-2xl text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-slate-900 border border-white/5 flex items-center justify-center text-slate-500 mx-auto">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h3 className="font-pixel-body text-sm font-bold uppercase tracking-wider text-slate-300">
              Admin Connection Required
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Please connect your authorized administrator wallet to gain access to the system control panel.
            </p>
          </div>
        ) : !isAdmin ? (
          <div className="max-w-md mx-auto mt-24 p-6 border border-rose-500/20 bg-rose-500/5 rounded-2xl text-center space-y-4 animate-fadeIn">
            <div className="h-12 w-12 rounded-full bg-rose-950/20 border border-rose-500/30 flex items-center justify-center text-rose-400 mx-auto">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h3 className="font-pixel-body text-sm font-bold uppercase tracking-wider text-rose-400">
              Access Denied
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              The connected wallet account <span className="font-mono text-[10px] bg-rose-950/30 border border-rose-500/20 px-1.5 py-0.5 rounded text-rose-300">{activeWallet.address}</span> is not authorized. 
              Only the system administrator wallet can view GigaWork metrics.
            </p>
          </div>
        ) : (
          <main className="max-w-5xl mx-auto py-10 px-6 space-y-8 animate-fadeIn">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/5">
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1.5 text-[9px] font-bold text-indigo-400 bg-indigo-950/40 border border-indigo-500/20 px-2.5 py-0.5 rounded uppercase tracking-wider font-mono">
                  <ShieldCheck className="h-3 w-3" /> System Operator Mode
                </span>
                <h1 className="text-2xl md:text-3xl font-extrabold uppercase tracking-wide text-slate-100 font-pixel-body">
                  GigaWork Control Center
                </h1>
                <p className="text-[10px] text-slate-500 font-mono uppercase">
                  Connected: 0xafe6dd...0549
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={fetchStats}
                disabled={loading}
                className="shrink-0 bg-slate-950/40 border-white/10 hover:bg-slate-900/60 font-semibold text-[10px] uppercase font-mono tracking-wider h-9"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5 text-indigo-400" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 text-indigo-400" />
                )}
                Re-Scan System
              </Button>
            </div>

            {loading && !stats ? (
              <div className="flex flex-col items-center justify-center py-32 gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-indigo-400" />
                <span className="text-xs text-slate-500 font-semibold uppercase tracking-widest font-mono">Quering system state...</span>
              </div>
            ) : error ? (
              <div className="p-4 border border-rose-500/20 bg-rose-500/5 rounded-xl text-center text-xs text-rose-400 max-w-md mx-auto">
                Error: {error}
              </div>
            ) : stats ? (
              <div className="space-y-8">
                {/* 8 Stats Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Card 1: Users */}
                  <div className="border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group hover:border-indigo-500/30 transition-all duration-300">
                    <div className="absolute right-0 top-0 h-24 w-24 bg-gradient-to-br from-indigo-500/5 to-transparent blur-xl rounded-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Registered Users</span>
                      <Users className="h-5 w-5 text-indigo-400 group-hover:scale-110 transition-transform" />
                    </div>
                    <div className="mt-4">
                      <span className="text-3xl font-extrabold text-slate-100">{stats.totalUsers}</span>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium">
                        Total wallets onboarded
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Credits Ledger */}
                  <div className="border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group hover:border-cyan-500/30 transition-all duration-300">
                    <div className="absolute right-0 top-0 h-24 w-24 bg-gradient-to-br from-cyan-500/5 to-transparent blur-xl rounded-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Total Credits Pool</span>
                      <Coins className="h-5 w-5 text-cyan-400 group-hover:rotate-12 transition-transform" />
                    </div>
                    <div className="mt-4">
                      <span className="text-3xl font-extrabold text-slate-100">{stats.totalCredits.toLocaleString()}</span>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium">
                        Active credit liquidity inside system
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Agents Minted */}
                  <div className="border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group hover:border-purple-500/30 transition-all duration-300">
                    <div className="absolute right-0 top-0 h-24 w-24 bg-gradient-to-br from-purple-500/5 to-transparent blur-xl rounded-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Custom Agents</span>
                      <Cpu className="h-5 w-5 text-purple-400 group-hover:scale-110 transition-transform" />
                    </div>
                    <div className="mt-4">
                      <span className="text-3xl font-extrabold text-slate-100">{stats.totalSkills}</span>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium">
                        Skills / AI Agents compiled &amp; minted
                      </div>
                    </div>
                  </div>

                  {/* Card 4: Active Cron Automation */}
                  <div className="border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group hover:border-emerald-500/30 transition-all duration-300">
                    <div className="absolute right-0 top-0 h-24 w-24 bg-gradient-to-br from-emerald-500/5 to-transparent blur-xl rounded-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Active Deployments</span>
                      <Activity className="h-5 w-5 text-emerald-400 animate-pulse" />
                    </div>
                    <div className="mt-4">
                      <span className="text-3xl font-extrabold text-slate-100">{stats.activeDeployments}</span>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium">
                        Schedules automated currently
                      </div>
                    </div>
                  </div>

                  {/* Card 5: Workflows count */}
                  <div className="border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group hover:border-blue-500/30 transition-all duration-300">
                    <div className="absolute right-0 top-0 h-24 w-24 bg-gradient-to-br from-blue-500/5 to-transparent blur-xl rounded-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Total Workflows</span>
                      <Activity className="h-5 w-5 text-blue-400" />
                    </div>
                    <div className="mt-4">
                      <span className="text-3xl font-extrabold text-slate-100">{stats.totalWorkflows}</span>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium">
                        {stats.completedWorkflows} successfully finished
                      </div>
                    </div>
                  </div>

                  {/* Card 6: Commerce Transaction Volume */}
                  <div className="border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group hover:border-amber-500/30 transition-all duration-300">
                    <div className="absolute right-0 top-0 h-24 w-24 bg-gradient-to-br from-amber-500/5 to-transparent blur-xl rounded-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Commerce Volume</span>
                      <Coins className="h-5 w-5 text-amber-400" />
                    </div>
                    <div className="mt-4">
                      <span className="text-3xl font-extrabold text-slate-100">${stats.totalUSDCVolume}</span>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium">
                        USDC budget handled on Arc Network
                      </div>
                    </div>
                  </div>

                  {/* Card 7: Space cTRNG Campaigns */}
                  <div className="border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group hover:border-cyan-500/30 transition-all duration-300">
                    <div className="absolute right-0 top-0 h-24 w-24 bg-gradient-to-br from-cyan-500/5 to-transparent blur-xl rounded-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Raffle Pools</span>
                      <Orbit className="h-5 w-5 text-cyan-400 group-hover:rotate-180 transition-transform duration-500" />
                    </div>
                    <div className="mt-4">
                      <span className="text-3xl font-extrabold text-slate-100">{stats.totalRaffles}</span>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium">
                        {stats.completedRaffles} draws complete
                      </div>
                    </div>
                  </div>

                  {/* Card 8: SpaceComputer SDK Status */}
                  <div className={`border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group transition-all duration-300 ${
                    stats.spaceComputerStatus === 'authenticated'
                      ? 'hover:border-emerald-500/30'
                      : 'hover:border-rose-500/30'
                  }`}>
                    <div className={`absolute right-0 top-0 h-24 w-24 bg-gradient-to-br blur-xl rounded-full ${
                      stats.spaceComputerStatus === 'authenticated'
                        ? 'from-emerald-500/5'
                        : 'from-rose-500/5'
                    }`} />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Orbitport SDK</span>
                      <ShieldCheck className={`h-5 w-5 ${
                        stats.spaceComputerStatus === 'authenticated' ? 'text-emerald-400' : 'text-rose-400'
                      }`} />
                    </div>
                    <div className="mt-4">
                      <span className={`text-xl font-extrabold uppercase font-pixel-body tracking-wide ${
                        stats.spaceComputerStatus === 'authenticated' ? 'text-emerald-400' : 'text-amber-400'
                      }`}>
                        {stats.spaceComputerStatus === 'authenticated' ? 'CONNECTED' : 'STANDBY'}
                      </span>
                      <div className="text-[10px] text-slate-500 mt-2 font-mono truncate max-w-full">
                        {stats.spaceComputerDetail || 'Unauthenticated IPFS fallback active.'}
                      </div>
                    </div>
                  </div>

                  {/* Card 9: x402 Nanopayments */}
                  <div className="border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group hover:border-amber-500/30 transition-all duration-300">
                    <div className="absolute right-0 top-0 h-24 w-24 bg-gradient-to-br from-amber-500/5 to-transparent blur-xl rounded-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">x402 Nanopayments</span>
                      <Coins className="h-5 w-5 text-amber-500 group-hover:scale-110 transition-transform" />
                    </div>
                    <div className="mt-4">
                      <span className="text-3xl font-extrabold text-slate-100">${stats.totalNanopaymentRevenue || '0.000'}</span>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium">
                        {stats.totalNanopaymentCalls || 0} API calls settled off-chain
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recent activity ledger */}
                <div className="border border-white/5 bg-slate-950/40 rounded-xl overflow-hidden backdrop-blur-sm">
                  <div className="p-4 border-b border-white/5 bg-slate-900/20 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <ArrowRightLeft className="h-4 w-4 text-indigo-400 animate-pulse" />
                      Recent Credit Activity Logs (Live System Ledger)
                    </h3>
                    <span className="text-[9px] text-indigo-400 bg-indigo-950/40 border border-indigo-500/20 px-2 py-0.5 rounded tracking-wide uppercase font-mono">
                      Real-time Feed
                    </span>
                  </div>
                  {activity.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-500 italic">
                      No recent transactional ledger entries found.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="border-b border-white/5 bg-slate-900/40 text-slate-400 font-semibold font-mono text-[10px] uppercase">
                            <th className="p-4">Timestamp &amp; Reference ID</th>
                            <th className="p-4">User Wallet</th>
                            <th className="p-4">Activity Description / Reason</th>
                            <th className="p-4 text-right">Ledger Delta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activity.map((act) => {
                            const formattedTime = new Date(act.createdAt).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                            const isPositive = act.delta > 0
                            return (
                              <tr key={act.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                <td className="p-4 space-y-1">
                                  <div className="font-bold text-slate-200 font-mono text-[11px]">{act.id.slice(0, 18)}...</div>
                                  <div className="text-[9px] text-slate-500 flex items-center gap-1">
                                    <Clock className="h-2.5 w-2.5" />
                                    {formattedTime}
                                  </div>
                                </td>
                                <td className="p-4">
                                  {act.userWallet ? (
                                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400 bg-slate-900/40 border border-white/5 px-2 py-1 rounded w-fit">
                                      <span>{act.userWallet.slice(0, 6)}...{act.userWallet.slice(-4)}</span>
                                      <button
                                        onClick={() => handleCopy(act.userWallet!, act.id)}
                                        className="text-slate-600 hover:text-slate-400 transition-colors"
                                        title="Copy Address"
                                      >
                                        {copiedId === act.id ? (
                                          <Check className="h-3 w-3 text-emerald-400" />
                                        ) : (
                                          <Copy className="h-3 w-3" />
                                        )}
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-slate-600 italic">Anonymous</span>
                                  )}
                                </td>
                                <td className="p-4 text-slate-300 font-medium">{act.reason}</td>
                                <td className={`p-4 text-right font-extrabold font-mono text-base ${
                                  isPositive ? 'text-emerald-400' : 'text-rose-400'
                                }`}>
                                  {isPositive ? `+${act.delta}` : act.delta} cr
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Recent Nanopayment Activity */}
                <div className="border border-white/5 bg-slate-950/40 rounded-xl overflow-hidden backdrop-blur-sm">
                  <div className="p-4 border-b border-white/5 bg-slate-900/20 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <Coins className="h-4 w-4 text-amber-500 animate-pulse" />
                      Recent x402 Nanopayment Logs (Live Settlement Feed)
                    </h3>
                    <span className="text-[9px] text-amber-500 bg-amber-950/40 border border-amber-500/20 px-2 py-0.5 rounded tracking-wide uppercase font-mono">
                      x402 Flow
                    </span>
                  </div>
                  {recentNanopayments.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-500 italic">
                      No recent nanopayment settlements found.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="border-b border-white/5 bg-slate-900/40 text-slate-400 font-semibold font-mono text-[10px] uppercase">
                            <th className="p-4">Event ID</th>
                            <th className="p-4">Buyer Wallet</th>
                            <th className="p-4">Agent Skill Name</th>
                            <th className="p-4">Status</th>
                            <th className="p-4 text-right">Payment USDC</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentNanopayments.map((np) => {
                            return (
                              <tr key={np.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                <td className="p-4 font-mono text-[11px] text-slate-200">
                                  {np.id.slice(0, 18)}...
                                </td>
                                <td className="p-4">
                                  <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400 bg-slate-900/40 border border-white/5 px-2 py-1 rounded w-fit">
                                    <span>{np.buyerAddress.slice(0, 6)}...{np.buyerAddress.slice(-4)}</span>
                                    <button
                                      onClick={() => handleCopy(np.buyerAddress, np.id)}
                                      className="text-slate-600 hover:text-slate-400 transition-colors"
                                      title="Copy Address"
                                    >
                                      {copiedId === np.id ? (
                                        <Check className="h-3 w-3 text-emerald-400" />
                                      ) : (
                                        <Copy className="h-3 w-3" />
                                      )}
                                    </button>
                                  </div>
                                </td>
                                <td className="p-4 text-slate-300 font-medium">{np.skillName}</td>
                                <td className="p-4">
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                                    np.status === 'settled'
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  }`}>
                                    {np.status}
                                  </span>
                                </td>
                                <td className="p-4 text-right font-extrabold font-mono text-base text-emerald-400">
                                  +{parseFloat(np.amountUsdc).toFixed(3)} USDC
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </main>
        )}
      </div>
    </div>
  )
}
