'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Orbit, Plus, Loader2, Sparkles, Trophy, HelpCircle } from 'lucide-react'
import { MainHeader } from '@/components/shell/MainHeader'
import { RaffleCard } from '@/components/raffle/RaffleCard'
import { Button } from '@/components/ui/button'

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

export default function RaffleLandingPage() {
  const [raffles, setRaffles] = useState<Raffle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  useEffect(() => {
    fetchRaffles()
  }, [])

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

        {/* Raffles Listing */}
        <main className="max-w-5xl mx-auto py-10 px-6 space-y-6">
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
      </div>
    </div>
  )
}
