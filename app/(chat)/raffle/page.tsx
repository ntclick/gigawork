'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Orbit,
  Plus,
  Loader2,
  Sparkles,
  Trophy,
  HelpCircle,
  ShieldCheck,
  Users,
  Activity,
  ExternalLink,
  Copy,
  Check,
  Calendar,
} from 'lucide-react'
import { MainHeader } from '@/components/shell/MainHeader'
import { RaffleCard } from '@/components/raffle/RaffleCard'
import { Button } from '@/components/ui/button'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'

interface Raffle {
  id: string
  title: string
  description?: string | null
  prizeDescription?: string | null
  winnerCount: number
  totalEntries: number
  commitBlock: number
  drawn: boolean
  createdAt: string
}

interface AdminRaffle {
  id: string
  title: string
  winnerCount: number
  totalEntries: number
  drawn: boolean
  commitBlock: number
  txHash?: string | null
  createdAt: string
  hostWallet?: string | null
}

interface AdminStats {
  totalRaffles: number
  activeRaffles: number
  completedRaffles: number
  totalEntries: number
  totalWinners: number
  spaceComputerStatus: string
  spaceComputerDetail: string
}

export default function RaffleLandingPage() {
  const activeWallet = useActiveWallet()
  const isAdmin = activeWallet?.address?.toLowerCase() === '0xafe6dd950dc2cf561e8daba1725e0e6840f70549'

  const [activeTab, setActiveTab] = useState<'pools' | 'admin'>('pools')
  const [raffles, setRaffles] = useState<Raffle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Admin stats states
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null)
  const [adminRaffles, setAdminRaffles] = useState<AdminRaffle[]>([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [copiedId, setCopiedId] = useState<string>('')

  const fetchRaffles = async () => {
    try {
      const res = await fetch('/api/raffles/list', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load raffle list.')
      }
      setRaffles(json.raffles || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred.')
    } finally {
      setLoading(false)
    }
  }

  const fetchAdminStats = async () => {
    setAdminLoading(true)
    setAdminError('')
    try {
      const res = await fetch('/api/admin/raffle-stats', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to retrieve admin stats.')
      }
      setAdminStats(json.stats)
      setAdminRaffles(json.raffles || [])
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Error fetching admin metrics.')
    } finally {
      setAdminLoading(false)
    }
  }

  useEffect(() => {
    fetchRaffles()
  }, [])

  // Auto-switch to pools tab if wallet changes and user is no longer admin
  useEffect(() => {
    if (!isAdmin && activeTab === 'admin') {
      setActiveTab('pools')
    }
  }, [isAdmin, activeTab])

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(''), 2000)
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0a0d14] text-white">
      {/* GigaWork standard main header */}
      <MainHeader />

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Cosmic Hero Section */}
        <section className="relative py-12 px-6 border-b border-white/5 bg-gradient-to-b from-slate-950 via-slate-950/80 to-[#0a0d14]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(8,145,178,0.1),transparent_60%)] pointer-events-none" />
          
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-8 relative">
            <div className="space-y-4 max-w-2xl">
              <span className="inline-flex items-center gap-1 text-xs text-cyan-400 font-bold bg-cyan-950/60 border border-cyan-500/20 px-3 py-1 rounded-full uppercase tracking-wider">
                <Sparkles className="h-3.5 w-3.5" /> SpaceComputer Verifiable Randomness
              </span>
              <h1 className="text-3xl md:text-4xl font-extrabold uppercase tracking-wide text-slate-100 font-pixel-body">
                Cosmic Name Raffle
              </h1>
              <p className="text-sm text-slate-400 leading-relaxed">
                A public, absolutely transparent, and independently cryptographically verifiable raffle system. 
                Powered by SpaceComputer's cTRNG cosmic randomness to ensure that no one can cheat or tamper with the results.
              </p>
            </div>

            <Link href="/raffle/create" className="shrink-0">
              <Button className="w-full md:w-auto bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-slate-950 font-bold uppercase tracking-wider text-xs px-6 py-3.5 rounded-xl shadow-lg shadow-cyan-500/15 flex items-center justify-center gap-1.5 transition-all duration-200">
                <Plus className="h-4 w-4 text-slate-950" />
                Create New Raffle
              </Button>
            </Link>
          </div>
        </section>

        {/* Provably Fair Explanation Section */}
        <section className="max-w-5xl mx-auto px-6 pt-8 pb-4">
          <div className="border border-cyan-500/15 bg-gradient-to-r from-cyan-950/20 to-indigo-950/20 rounded-2xl p-6 flex flex-col md:flex-row gap-6 items-start justify-between relative overflow-hidden">
            <div className="absolute right-0 top-0 h-40 w-40 bg-gradient-to-br from-cyan-500/10 to-transparent blur-3xl pointer-events-none rounded-full" />
            
            <div className="space-y-3 flex-1">
              <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5 font-pixel-body">
                <Sparkles className="h-4 w-4 animate-pulse" />
                How Provably-Fair Drawings Work
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                Every drawing on GigaWork is completely transparent and mathematically verifiable. 
                First, the contestant list is permanently frozen into a cryptographic <strong>Merkle Tree Root</strong> stored on-chain at the moment of creation. 
                Once your target future blockchain block is reached, our drawing engine mixes **SpaceComputer Satellite Cosmic Ray Entropy (cTRNG)** with the **On-Chain Block Hash** to derive a completely unpredictable Cosmic Seed. 
                An immutable Solidity contract then runs a **Fisher-Yates Shuffle** directly on-chain to choose the winners. 
                Neither GigaWork, the campaign host, nor space operators can predict or manipulate the outcome!
              </p>
            </div>

            <div className="flex flex-col gap-2.5 w-full md:w-auto shrink-0 md:pt-2">
              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono bg-slate-900/60 border border-white/5 px-3 py-2 rounded-xl">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" style={{ animationDuration: '3s' }} />
                Dual-Entropy Engine Online
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono bg-slate-900/60 border border-white/5 px-3 py-2 rounded-xl">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                ArcScan Contract Verified
              </div>
            </div>
          </div>
        </section>

        {/* Tab switcher for admin wallet */}
        {isAdmin && (
          <div className="flex border-b border-white/5 max-w-5xl mx-auto px-6 mt-6">
            <button
              onClick={() => setActiveTab('pools')}
              className={`pb-3.5 px-6 font-pixel-body text-xs uppercase tracking-wider font-bold border-b-2 transition-all duration-200 ${
                activeTab === 'pools'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              Contest Pools
            </button>
            <button
              onClick={() => {
                setActiveTab('admin')
                fetchAdminStats()
              }}
              className={`pb-3.5 px-6 font-pixel-body text-xs uppercase tracking-wider font-bold border-b-2 transition-all duration-200 flex items-center gap-1.5 ${
                activeTab === 'admin'
                  ? 'border-indigo-500 text-indigo-400 shadow-[0_4px_12px_rgba(99,102,241,0.15)]'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              <ShieldCheck className="h-4 w-4 text-indigo-400" />
              Admin Dashboard
            </button>
          </div>
        )}

        {/* Active view renderer */}
        {activeTab === 'admin' && isAdmin ? (
          <main className="max-w-5xl mx-auto py-8 px-6 space-y-8 animate-fadeIn">
            {/* Admin metrics header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-white/5">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <Activity className="h-4.5 w-4.5 text-indigo-400" />
                  Raffle Ecosystem Performance Metrics
                </h2>
                <p className="text-[10px] text-slate-500 mt-1 font-mono uppercase">
                  Privileged view for system administrator: 0xafe6dd...0549
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchAdminStats}
                disabled={adminLoading}
                className="shrink-0 bg-slate-950/40 border-white/10 hover:bg-slate-900/60 font-semibold text-[10px] uppercase font-mono tracking-wider h-8"
              >
                {adminLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                ) : (
                  <Orbit className="h-3 w-3 mr-1.5" />
                )}
                Refresh Ledger
              </Button>
            </div>

            {adminLoading && !adminStats ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                <span className="text-xs text-slate-500 font-semibold uppercase tracking-widest font-mono">Compiling ledger statistics...</span>
              </div>
            ) : adminError ? (
              <div className="p-4 border border-rose-500/20 bg-rose-500/5 rounded-xl text-center text-xs text-rose-400 max-w-md mx-auto">
                Error: {adminError}
              </div>
            ) : adminStats ? (
              <div className="space-y-8">
                {/* Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Card 1: Total Pools */}
                  <div className="border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group hover:border-indigo-500/30 transition-all duration-300">
                    <div className="absolute right-0 top-0 h-24 w-24 bg-gradient-to-br from-indigo-500/5 to-transparent blur-xl rounded-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Total Pools</span>
                      <Orbit className="h-5 w-5 text-indigo-400 group-hover:rotate-180 transition-transform duration-500" />
                    </div>
                    <div className="mt-4">
                      <span className="text-3xl font-extrabold text-slate-100">{adminStats.totalRaffles}</span>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium">
                        {adminStats.activeRaffles} Active, {adminStats.completedRaffles} Completed
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Total Contestants */}
                  <div className="border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group hover:border-cyan-500/30 transition-all duration-300">
                    <div className="absolute right-0 top-0 h-24 w-24 bg-gradient-to-br from-cyan-500/5 to-transparent blur-xl rounded-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Total Entries</span>
                      <Users className="h-5 w-5 text-cyan-400 group-hover:scale-110 transition-transform" />
                    </div>
                    <div className="mt-4">
                      <span className="text-3xl font-extrabold text-slate-100">{adminStats.totalEntries}</span>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium">
                        Tickets submitted across all campaigns
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Completion Rate */}
                  <div className="border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group hover:border-amber-500/30 transition-all duration-300">
                    <div className="absolute right-0 top-0 h-24 w-24 bg-gradient-to-br from-amber-500/5 to-transparent blur-xl rounded-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Completed Draws</span>
                      <Trophy className="h-5 w-5 text-amber-400 animate-pulse" />
                    </div>
                    <div className="mt-4">
                      <span className="text-3xl font-extrabold text-slate-100">
                        {adminStats.totalRaffles > 0
                          ? Math.round((adminStats.completedRaffles / adminStats.totalRaffles) * 100)
                          : 0}%
                      </span>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium">
                        {adminStats.completedRaffles} draws finalized on-chain ({adminStats.totalWinners} winners)
                      </div>
                    </div>
                  </div>

                  {/* Card 4: SpaceComputer SDK Status */}
                  <div className={`border border-white/5 bg-slate-900/40 backdrop-blur-md rounded-xl p-5 relative overflow-hidden group transition-all duration-300 ${
                    adminStats.spaceComputerStatus === 'authenticated'
                      ? 'hover:border-emerald-500/30'
                      : 'hover:border-rose-500/30'
                  }`}>
                    <div className={`absolute right-0 top-0 h-24 w-24 bg-gradient-to-br blur-xl rounded-full ${
                      adminStats.spaceComputerStatus === 'authenticated'
                        ? 'from-emerald-500/5'
                        : 'from-rose-500/5'
                    }`} />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">SpaceComputer SDK</span>
                      <ShieldCheck className={`h-5 w-5 ${
                        adminStats.spaceComputerStatus === 'authenticated' ? 'text-emerald-400' : 'text-rose-400'
                      }`} />
                    </div>
                    <div className="mt-4">
                      <span className={`text-xl font-extrabold uppercase font-pixel-body tracking-wide ${
                        adminStats.spaceComputerStatus === 'authenticated' ? 'text-emerald-400' : 'text-amber-400'
                      }`}>
                        {adminStats.spaceComputerStatus === 'authenticated' ? 'CONNECTED' : 'STANDBY'}
                      </span>
                      <div className="text-[10px] text-slate-500 mt-2 font-mono truncate max-w-full">
                        {adminStats.spaceComputerDetail || 'Unauthenticated fallback active.'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detailed Pool List Table */}
                <div className="border border-white/5 bg-slate-950/40 rounded-xl overflow-hidden backdrop-blur-sm">
                  <div className="p-4 border-b border-white/5 bg-slate-900/20">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                      Global Raffle Pool Ledger ({adminRaffles.length} pools logged)
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-white/5 bg-slate-900/40 text-slate-400 font-semibold font-mono text-[10px] uppercase">
                          <th className="p-4">Raffle Title &amp; ID</th>
                          <th className="p-4">Host Wallet</th>
                          <th className="p-4 text-center">Entries</th>
                          <th className="p-4 text-center">Winners</th>
                          <th className="p-4 text-center">Target Block</th>
                          <th className="p-4 text-center">Status</th>
                          <th className="p-4 text-right">Verification Proof</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminRaffles.map((r) => {
                          const formattedDate = new Date(r.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                          return (
                            <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                              <td className="p-4 space-y-1">
                                <div className="font-bold text-slate-200 line-clamp-1">{r.title}</div>
                                <div className="text-[9px] text-slate-500 flex items-center gap-2">
                                  <span className="font-mono">{r.id.slice(0, 8)}...</span>
                                  <span>•</span>
                                  <span className="flex items-center gap-1">
                                    <Calendar className="h-2.5 w-2.5" />
                                    {formattedDate}
                                  </span>
                                </div>
                              </td>
                              <td className="p-4">
                                {r.hostWallet ? (
                                  <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400 bg-slate-900/40 border border-white/5 px-2 py-1 rounded w-fit">
                                    <span>{r.hostWallet.slice(0, 6)}...{r.hostWallet.slice(-4)}</span>
                                    <button
                                      onClick={() => handleCopy(r.hostWallet!, r.id)}
                                      className="text-slate-600 hover:text-slate-400 transition-colors"
                                      title="Copy Address"
                                    >
                                      {copiedId === r.id ? (
                                        <Check className="h-3 w-3 text-emerald-400" />
                                      ) : (
                                        <Copy className="h-3 w-3" />
                                      )}
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-slate-600 italic">Unknown</span>
                                )}
                              </td>
                              <td className="p-4 text-center font-bold text-slate-300">{r.totalEntries}</td>
                              <td className="p-4 text-center font-bold text-slate-300">{r.winnerCount}</td>
                              <td className="p-4 text-center font-mono text-slate-400 font-medium">#{r.commitBlock}</td>
                              <td className="p-4 text-center">
                                {r.drawn ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-500/20 font-bold text-[9px] uppercase tracking-wide">
                                    Drawn
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-950/40 text-cyan-400 border border-cyan-500/20 font-bold text-[9px] uppercase tracking-wide">
                                    Active
                                  </span>
                                )}
                              </td>
                              <td className="p-4 text-right">
                                {r.drawn && r.txHash ? (
                                  <div className="flex flex-col items-end gap-1">
                                    <a
                                      href={`https://testnet.arcscan.app/tx/${r.txHash}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 font-mono font-bold transition-colors"
                                    >
                                      ArcScan Proof
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                    <a
                                      href="https://ipfs.io/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[9px] text-cyan-400 hover:text-cyan-300 font-mono transition-colors"
                                    >
                                      IPFS cTRNG Beacon
                                      <ExternalLink className="h-2.5 w-2.5" />
                                    </a>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-500 italic font-mono">Awaiting Draw</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </main>
        ) : (
          /* Raffles Listing (Visible to everyone) */
          <main className="max-w-5xl mx-auto py-10 px-6 space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Orbit className="h-4.5 w-4.5 text-cyan-500 animate-spin" style={{ animationDuration: '10s' }} />
                Active Cosmic Raffles
              </h2>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
                <span className="text-xs text-slate-500 font-semibold uppercase tracking-widest">Loading Cosmic Raffles...</span>
              </div>
            ) : error ? (
              <div className="p-4 border border-rose-500/20 bg-rose-500/5 rounded-xl text-center text-xs text-rose-400 max-w-md mx-auto">
                Error: {error}
              </div>
            ) : raffles.length === 0 ? (
              <div className="border border-dashed border-white/5 bg-slate-950/20 rounded-2xl py-16 px-6 text-center space-y-4 max-w-xl mx-auto flex flex-col items-center justify-center">
                <div className="h-12 w-12 rounded-full bg-slate-900/80 border border-white/5 flex items-center justify-center text-slate-600">
                  <HelpCircle className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-slate-300 font-bold text-sm">No Active Cosmic Raffles Found</h4>
                  <p className="text-slate-500 text-xs max-w-xs mx-auto">
                    Be the first to launch a verifiable, provably-fair giveaway campaign!
                  </p>
                </div>
                <Link href="/raffle/create">
                  <Button className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs py-2 px-4 border border-slate-700">
                    Create Raffle Now
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {raffles.map((raffle) => (
                  <RaffleCard key={raffle.id} raffle={raffle} />
                ))}
              </div>
            )}
          </main>
        )}
      </div>
    </div>
  )
}
