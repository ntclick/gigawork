'use client'

import { Trophy, Compass, Star, Loader2, Activity } from 'lucide-react'

interface Winner {
  id: string
  index: number
  username: string
  merkleProof: unknown
}

interface WinnersListProps {
  drawn: boolean
  winners: Winner[]
  prizeDescription?: string | null
  currentBlock?: number
  commitBlock?: number
}

export function WinnersList({ drawn, winners, prizeDescription, currentBlock, commitBlock }: WinnersListProps) {
  
  // Calculate block progression variables
  const blocksRemaining = commitBlock && currentBlock ? BigInt(commitBlock) - BigInt(currentBlock) : 0n
  const blocksPassed = commitBlock && currentBlock ? Math.max(0, 10 - Number(blocksRemaining)) : 0
  const percent = Math.min(100, Math.max(0, (blocksPassed / 10) * 100))

  if (!drawn) {
    return (
      <div className="relative border border-white/5 bg-slate-950/40 rounded-2xl p-6 flex flex-col justify-center overflow-hidden h-72 space-y-4 animate-fadeIn">
        <div className="absolute -inset-10 bg-gradient-to-tr from-cyan-500/5 to-indigo-500/5 opacity-55 blur-xl pointer-events-none animate-pulse" />
        
        <div className="flex items-center gap-3 pb-3 border-b border-white/5 z-10">
          <div className="h-9 w-9 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 relative shrink-0">
            <Compass className="h-5 w-5 text-cyan-400 animate-spin" style={{ animationDuration: '10s' }} />
            <Star className="h-2.5 w-2.5 text-indigo-400 absolute -top-0.5 -right-0.5 animate-ping" />
          </div>
          <div className="text-left">
            <h4 className="text-slate-200 font-bold text-xs uppercase tracking-wider leading-none">Awaiting Cosmic Entropy</h4>
            <span className="text-[10px] text-slate-500">Evaluating physical beacon targets...</span>
          </div>
        </div>

        {commitBlock && currentBlock && Number(blocksRemaining) > 0 ? (
          <div className="space-y-3.5 z-10 text-left pt-1 font-mono">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-semibold uppercase tracking-wider text-[9px]">Arc Network Telemetry:</span>
              <span className="text-cyan-400 font-bold text-[9px] bg-cyan-950/40 border border-cyan-500/20 px-2 py-0.5 rounded flex items-center gap-1 animate-pulse">
                <Activity className="h-3 w-3" />
                AWAITING_MINING
              </span>
            </div>

            {/* Pulsing visual progress bar */}
            <div className="space-y-1.5">
              <div className="w-full h-3 bg-black/60 rounded-full border border-white/5 overflow-hidden p-0.5">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-cyan-300 rounded-full shadow-[0_0_12px_rgba(34,211,238,0.4)] transition-all duration-700 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-slate-500">
                <span>Start: #{commitBlock - 10}</span>
                <span>Active: #{currentBlock}</span>
                <span>Target: #{commitBlock}</span>
              </div>
            </div>

            {/* Stat block */}
            <div className="bg-black/40 border border-white/5 rounded-xl p-3 text-[10px] leading-relaxed text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>Target Anchor Block:</span>
                <span className="text-slate-200">#{commitBlock}</span>
              </div>
              <div className="flex justify-between">
                <span>Required Blocks:</span>
                <span className="text-amber-400 font-bold">{Number(blocksRemaining)} block(s) left</span>
              </div>
              <div className="flex justify-between">
                <span>Estimated Time:</span>
                <span className="text-slate-200">~{Number(blocksRemaining) * 2} seconds</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center py-6 space-y-3 z-10">
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Star className="h-5 w-5 animate-pulse" />
            </div>
            <div className="space-y-1">
              <p className="text-slate-200 font-bold text-xs uppercase tracking-wider">Target block reached!</p>
              <p className="text-slate-500 text-[11px] max-w-xs leading-relaxed">
                Block #{commitBlock} is fully mined. The host can now derive SpaceComputer randomness and declare winners.
              </p>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="border border-white/10 bg-slate-950/75 backdrop-blur-md rounded-2xl p-5 space-y-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-300 hover:border-cyan-500/20 animate-fadeIn">
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <h4 className="text-sm font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2 font-pixel-body">
          <Trophy className="h-4.5 w-4.5 text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
          Official Winner Board
        </h4>
        <span className="text-[10px] text-amber-400 font-bold bg-amber-950/40 border border-amber-500/25 px-2.5 py-1 rounded uppercase tracking-wider shadow-[0_0_10px_rgba(245,158,11,0.1)]">
          {winners.length} Winners
        </span>
      </div>

      {prizeDescription && (
        <div className="text-xs text-amber-300 bg-gradient-to-r from-amber-950/20 to-yellow-950/15 border border-amber-500/20 p-3 rounded-xl flex items-start gap-2.5 shadow-[inset_0_0_12px_rgba(245,158,11,0.03)]">
          <Trophy className="h-4 w-4 shrink-0 text-amber-400 mt-0.5 animate-bounce" />
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Prize Reward:</span>
            <strong className="tracking-wide text-amber-400 text-sm">{prizeDescription}</strong>
          </div>
        </div>
      )}

      {/* Winners list */}
      <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
        {winners.map((winner, idx) => (
          <div
            key={winner.id}
            className="flex items-center justify-between p-4 rounded-xl border border-amber-500/20 bg-gradient-to-r from-slate-950 to-amber-950/5 text-xs font-mono transition-all duration-300 hover:border-amber-400/40 hover:bg-amber-950/10 shadow-[0_2px_8px_rgba(0,0,0,0.2)]"
          >
            <div className="flex items-center gap-3">
              <span className="h-6 w-6 rounded-full bg-gradient-to-br from-amber-500 to-yellow-500 text-slate-950 font-bold flex items-center justify-center text-[10.5px] shadow-[0_0_8px_rgba(245,158,11,0.3)]">
                {idx + 1}
              </span>
              <div>
                <span className="text-slate-100 text-sm font-semibold block tracking-wide">{winner.username}</span>
                <span className="text-[10px] text-slate-500">Ticket Index #{winner.index}</span>
              </div>
            </div>
            
            <div className="text-right">
              <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/40 border border-emerald-500/20 px-2.5 py-0.5 rounded tracking-wide uppercase shadow-[0_0_8px_rgba(52,211,153,0.05)]">
                Verified
              </span>
            </div>
          </div>
        ))}

        {winners.length === 0 && (
          <div className="text-center text-slate-500 text-xs py-8 font-medium font-mono">
            No winners recorded.
          </div>
        )}
      </div>
    </div>
  )
}
