'use client'

import { Shield, Trophy, Award, Crown } from 'lucide-react'

interface ReputationBadgeProps {
  score: number
  showLabel?: boolean
}

export function ReputationBadge({ score, showLabel = true }: ReputationBadgeProps) {
  let tier = 'Rookie'
  let colorClass = 'border-slate-500/30 bg-slate-500/10 text-slate-300'
  let Icon = Shield

  if (score >= 50) {
    tier = 'Elite'
    colorClass = 'border-purple-400/30 bg-purple-500/10 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
    Icon = Crown
  } else if (score >= 20) {
    tier = 'Veteran'
    colorClass = 'border-amber-400/30 bg-amber-500/10 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
    Icon = Trophy
  } else if (score >= 5) {
    tier = 'Professional'
    colorClass = 'border-cyan-400/30 bg-cyan-500/10 text-cyan-300'
    Icon = Award
  }

  return (
    <div className="flex items-center gap-2">
      <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wider uppercase transition ${colorClass}`}>
        <Icon className="h-3.5 w-3.5" />
        <span>{score} pts</span>
      </div>
      {showLabel && (
        <span className="text-xs text-white/50">
          Rank: <strong className="text-white/80">{tier}</strong>
        </span>
      )}
    </div>
  )
}
