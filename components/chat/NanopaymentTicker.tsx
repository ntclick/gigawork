import { useNanopaymentStream } from '@/lib/hooks/useNanopaymentStream'
import { Bolt } from 'lucide-react'

export function NanopaymentTicker({ workflowId, active }: { workflowId: string; active: boolean }) {
  const { events, newlyAddedIds, totalUsdc, callCount } = useNanopaymentStream(workflowId, active)

  if (events.length === 0) return null

  return (
    <div className="absolute right-4 top-4 z-30 w-72 rounded-xl border border-white/[0.08] bg-[#0c0e14]/90 p-3 shadow-2xl backdrop-blur-md transition duration-300">
      <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2">
        <div className="flex items-center gap-1.5">
          <Bolt className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/80">
            ⚡ x402 Nanopayments
          </span>
        </div>
        <span className="text-[10px] text-white/45 font-mono">{callCount} calls</span>
      </div>

      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
        {events.slice(0, 5).map((e) => {
          const isNew = newlyAddedIds.has(e.id)
          return (
            <div
              key={e.id}
              className={`flex items-center justify-between rounded px-2 py-1 text-[11px] transition duration-500 ${
                isNew
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                  : 'bg-white/[0.02] text-white/70 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-amber-500">⚡</span>
                <span className="truncate font-medium">{e.skillName}</span>
              </div>
              <span className="font-mono text-emerald-400 font-semibold shrink-0">
                +{parseFloat(e.amountUsdc).toFixed(2)}
              </span>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-2 mt-2 text-[11px]">
        <span className="text-white/40">Total settled</span>
        <span className="font-mono font-bold text-emerald-400">{totalUsdc} USDC</span>
      </div>
    </div>
  )
}
