'use client'

import Link from 'next/link'
import { Calendar, Users, Trophy, ChevronRight, Orbit } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

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

interface RaffleCardProps {
  raffle: Raffle
}

export function RaffleCard({ raffle }: RaffleCardProps) {
  const formattedDate = new Date(raffle.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-slate-900/60 p-[1px] backdrop-blur-md transition-all duration-300 hover:border-cyan-500/50 hover:shadow-[0_0_15px_rgba(6,182,212,0.15)]">
      {/* Dynamic orbital glow under the card on hover */}
      <div className="absolute -inset-10 -z-10 bg-gradient-to-r from-cyan-500/10 to-indigo-500/10 opacity-0 blur-xl transition-all duration-500 group-hover:opacity-100 group-hover:duration-300" />
      
      <div className="h-full rounded-xl bg-slate-950/80 p-5 flex flex-col justify-between">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
              <Calendar className="h-3.5 w-3.5" />
              {formattedDate}
            </span>
            {raffle.drawn ? (
              <Badge className="bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 font-semibold px-2 py-0.5 rounded flex items-center gap-1 text-[10px] tracking-wide uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Drawn
              </Badge>
            ) : (
              <Badge className="bg-cyan-950/60 text-cyan-400 border border-cyan-500/30 font-semibold px-2 py-0.5 rounded flex items-center gap-1 text-[10px] tracking-wide uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping" />
                Active
              </Badge>
            )}
          </div>

          {/* Title */}
          <h3 className="text-lg font-bold text-slate-100 group-hover:text-cyan-400 transition-colors duration-200 line-clamp-1">
            {raffle.title}
          </h3>

          {/* Prize description */}
          {raffle.prizeDescription && (
            <p className="mt-2 text-sm text-amber-400 font-medium flex items-center gap-1.5 bg-amber-500/5 px-2.5 py-1 rounded border border-amber-500/10">
              <Trophy className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{raffle.prizeDescription}</span>
            </p>
          )}

          {/* Description */}
          {raffle.description && (
            <p className="mt-3 text-xs text-slate-400 line-clamp-2 leading-relaxed h-8">
              {raffle.description}
            </p>
          )}
        </div>

        {/* Info Metrics */}
        <div className="mt-5 pt-4 border-t border-white/5 flex items-center justify-between text-xs text-slate-400">
          <div className="flex gap-4">
            <div className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-slate-500" />
              <span>
                <strong>{raffle.totalEntries}</strong> entries
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Trophy className="h-3.5 w-3.5 text-slate-500" />
              <span>
                <strong>{raffle.winnerCount}</strong> winners
              </span>
            </div>
          </div>
          
          <Link
            href={`/raffle/${raffle.id}`}
            className="flex items-center gap-0.5 text-cyan-400 font-semibold uppercase tracking-wider text-[10px] group-hover:text-cyan-300 transition-colors"
          >
            Details
            <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </div>
    </div>
  )
}
