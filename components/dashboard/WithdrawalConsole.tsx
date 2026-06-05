import React, { useState } from 'react'
import { Coins, ArrowDownCircle, Shield, Info, ExternalLink } from 'lucide-react'

interface WithdrawalConsoleProps {
  totalRevenueUsdc: number
  settlementQueueCount: number
  onResetRevenue: () => void
}

export function WithdrawalConsole({
  totalRevenueUsdc,
  settlementQueueCount,
  onResetRevenue,
}: WithdrawalConsoleProps) {
  const [confirmed, setConfirmed] = useState(false)

  const handleSettle = () => {
    if (totalRevenueUsdc <= 0) return
    onResetRevenue()
    setConfirmed(true)
    setTimeout(() => setConfirmed(false), 3000)
  }

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between">
        <h3 className="font-pixel-header text-sm text-slate-100 font-bold tracking-wider flex items-center gap-2">
          <Shield className="h-4 w-4 text-cyan-400" />
          SETTLEMENT
        </h3>
        <span className="text-[10px] bg-amber-950/40 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-mono uppercase tracking-wide">
          Testnet · Simulated
        </span>
      </div>

      <div className="p-5 space-y-5">
        {/* Balance Display */}
        <div className="flex items-baseline gap-3 bg-black/20 p-4 border border-slate-800 rounded-lg">
          <Coins className="h-7 w-7 text-emerald-400 shrink-0" />
          <div>
            <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold font-mono">PENDING SETTLEMENT</div>
            <div className="text-3xl font-black text-white font-mono">
              ${totalRevenueUsdc.toFixed(4)} <span className="text-sm font-normal text-slate-400">USDC</span>
            </div>
          </div>
        </div>

        {/* Queue Info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-black/10 border border-slate-800 rounded-lg p-3 text-center">
            <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold font-mono mb-1">QUEUE</div>
            <div className="text-lg font-bold text-white font-mono">{settlementQueueCount}</div>
            <div className="text-[9px] text-slate-500 font-mono">EIP-3009 auths</div>
          </div>
          <div className="bg-black/10 border border-slate-800 rounded-lg p-3 text-center">
            <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold font-mono mb-1">NETWORK</div>
            <div className="text-lg font-bold text-purple-400 font-mono">Arc</div>
            <div className="text-[9px] text-slate-500 font-mono">Testnet 5042002</div>
          </div>
        </div>

        {/* Info Notice */}
        <div className="flex items-start gap-2 text-[10px] text-slate-400 font-mono bg-slate-950/50 border border-slate-800/50 rounded-lg p-3">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-cyan-500" />
          <span>Circle Gateway batches EIP-3009 authorizations and settles USDC on-chain periodically. On mainnet, use <code className="text-cyan-400">circle gateway withdraw</code> CLI.</span>
        </div>

        {/* Settle Button */}
        <button
          onClick={handleSettle}
          disabled={totalRevenueUsdc <= 0}
          className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold font-mono tracking-wider transition ${
            totalRevenueUsdc <= 0
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              : confirmed
              ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-500/30'
              : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-black hover:scale-[1.01] hover:brightness-110 active:scale-[0.99] cursor-pointer shadow-lg shadow-emerald-500/10'
          }`}
        >
          <ArrowDownCircle className="h-4 w-4" />
          <span>{confirmed ? '✓ COUNTERS RESET' : 'RESET & SETTLE (TESTNET)'}</span>
        </button>
      </div>
    </div>
  )
}
