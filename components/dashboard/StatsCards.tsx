import React from 'react'
import { Coins, Zap, Users, ShieldCheck, ArrowUpRight } from 'lucide-react'

interface StatsCardsProps {
  totalRevenueUsdc: number
  totalApiCalls: number
  totalFailedCalls: number
  activeBuyersCount: number
  settledCount: number
}

export function StatsCards({
  totalRevenueUsdc,
  totalApiCalls,
  totalFailedCalls,
  activeBuyersCount,
  settledCount,
}: StatsCardsProps) {
  const successRate = totalApiCalls + totalFailedCalls > 0
    ? (totalApiCalls / (totalApiCalls + totalFailedCalls)) * 100
    : 100

  const cards = [
    {
      title: 'TOTAL USDC EARNED',
      value: `$${totalRevenueUsdc.toFixed(4)}`,
      sub: 'USDC Nanopayments Settled',
      icon: Coins,
      color: 'from-emerald-500/10 to-teal-500/10 border-emerald-500/30 text-emerald-400',
      glow: 'shadow-[0_0_20px_rgba(16,185,129,0.15)]',
    },
    {
      title: 'API REQUESTS',
      value: `${totalApiCalls + totalFailedCalls}`,
      sub: `${successRate.toFixed(1)}% Success Rate (${totalApiCalls} OK / ${totalFailedCalls} Err)`,
      icon: Zap,
      color: 'from-cyan-500/10 to-blue-500/10 border-cyan-500/30 text-cyan-400',
      glow: 'shadow-[0_0_20px_rgba(6,182,212,0.15)]',
    },
    {
      title: 'ACTIVE BUYERS',
      value: `${activeBuyersCount}`,
      sub: 'Unique M2M Agent addresses',
      icon: Users,
      color: 'from-purple-500/10 to-fuchsia-500/10 border-purple-500/30 text-purple-400',
      glow: 'shadow-[0_0_20px_rgba(168,85,247,0.15)]',
    },
    {
      title: 'BATCH SETTLEMENTS',
      value: `${settledCount}`,
      sub: 'Circle EIP-3009 Authorizations',
      icon: ShieldCheck,
      color: 'from-amber-500/10 to-orange-500/10 border-amber-500/30 text-amber-400',
      glow: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]',
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card, idx) => {
        const Icon = card.icon
        return (
          <div
            key={idx}
            className={`relative overflow-hidden bg-slate-900/60 backdrop-blur border rounded-xl p-5 transition-all duration-300 hover:scale-[1.02] hover:-translate-y-0.5 bg-gradient-to-br ${card.color} ${card.glow}`}
          >
            {/* Design patterns decoration */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-white/[0.03] to-transparent rounded-bl-full pointer-events-none" />
            
            <div className="flex justify-between items-start mb-3">
              <span className="font-mono text-[10px] tracking-widest text-slate-400 font-bold uppercase">
                {card.title}
              </span>
              <div className="p-2 rounded-lg bg-black/30 border border-white/5">
                <Icon className="h-4 w-4" />
              </div>
            </div>
            
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-white tracking-tight leading-none">
                {card.value}
              </span>
            </div>
            
            <p className="text-xs text-slate-400 mt-2 font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 animate-pulse" />
              {card.sub}
            </p>
          </div>
        )
      })}
    </div>
  )
}
