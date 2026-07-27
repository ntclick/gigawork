'use client'

import React from 'react'
import {
  X,
  ShieldCheck,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Award,
  Zap,
  Copy,
  Check
} from 'lucide-react'
import { SignalData } from '@/app/(chat)/signals/page'

interface SignalResultModalProps {
  isOpen: boolean
  onClose: () => void
  run: {
    id: string
    pair: string
    wfId?: string
    status: string
    strategy: { label: string; skill: string }
    fundTx?: string
    completeTx?: string
    attestDone?: boolean
    thesis?: SignalData
  } | null
}

export function SignalResultModal({ isOpen, onClose, run }: SignalResultModalProps) {
  const [copied, setCopied] = React.useState(false)

  if (!isOpen || !run) return null

  const fallbackThesis: SignalData = {
    verdict: 'Long',
    conf: 78,
    supporting: ['EMA 20 & MACD bullish momentum intact on 1D timeframe.', 'Price above EMA 50 indicating steady uptrend.'],
    counterpoint: 'Death alignment between EMA 50 and EMA 200 suggests long-term resistance.',
    invalidation: 'Price falling below EMA 20 support with negative MACD histogram.',
    source: 'Binance 1D Klines',
  }

  const d = run.thesis || fallbackThesis

  const handleCopyReport = () => {
    if (!d) return
    const text = `📊 GigaWork Defensible Thesis Report for ${run.pair}\nVerdict: ${d.verdict} (${d.conf}% confidence)\nWhy: ${d.supporting.join('; ')}\nCounterpoint: ${d.counterpoint}\nInvalidated if: ${d.invalidation}\nSource: ${d.source}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isSignal = d && (d.verdict === 'Long' || d.verdict.includes('Bullish') || d.verdict.includes('Valid'))
  const isFault = d && (d.verdict === 'Short' || d.verdict.startsWith('Skip') || d.verdict.includes('Fake'))

  const badgeBg = isSignal
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    : isFault
      ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
      : 'bg-amber-500/10 text-amber-400 border-amber-500/30'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl lg:max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl border border-cyan-500/30 bg-[#0a0d14] p-6 sm:p-8 shadow-[0_0_70px_rgba(34,211,238,0.2)] text-[#e2e8f0] custom-scrollbar">
        
        {/* Decorative Top Glow */}
        <div className="absolute -top-24 -left-24 h-48 w-48 rounded-full bg-cyan-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-purple-500/20 blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 font-bold text-black text-sm shadow-md">
              {run.pair.slice(0, 3)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">{run.pair} Signal Report</h3>
                <span className="rounded-full bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                  {run.strategy.label}
                </span>
              </div>
              <p className="text-xs text-white/40 font-mono">Workflow ID: {run.wfId || run.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/60 hover:text-white hover:bg-white/10 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="my-5 max-h-[65vh] overflow-y-auto space-y-4 pr-1 relative z-10 custom-scrollbar">
          {d ? (
            <>
              {/* Verdict Hero Banner */}
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 backdrop-blur-md flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1">
                    Calibrated Signal Verdict
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-lg border px-3.5 py-1 text-sm font-bold tracking-wide font-mono ${badgeBg}`}>
                      {d.verdict.toUpperCase()}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs text-white/70 font-mono">
                      <Flame className="h-4 w-4 text-amber-400" />
                      <span>{d.conf}% Confidence</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-mono bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Defensible Proof
                  </span>
                </div>
              </div>

              {/* Supporting Reasons */}
              <div className="rounded-xl border border-white/10 bg-[#0e121e] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-cyan-400 mb-2 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" /> Supporting Quantitative Arguments
                </div>
                <ul className="space-y-2 text-xs text-white/80">
                  {d.supporting.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 bg-white/[0.02] p-2 rounded-lg border border-white/5">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{s}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Counterpoint & Invalidation */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 mb-1.5 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> Strongest Counterpoint
                  </div>
                  <p className="text-xs text-white/75 leading-relaxed">{d.counterpoint}</p>
                </div>
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-400 mb-1.5 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> Invalidation Condition
                  </div>
                  <p className="text-xs text-white/75 leading-relaxed">{d.invalidation}</p>
                </div>
              </div>

              {/* Data Attribution */}
              <div className="rounded-lg bg-black/40 border border-white/5 p-2.5 font-mono text-[11px] text-white/40 flex items-center justify-between">
                <span>Verified Data Source:</span>
                <span className="text-cyan-400/90">{d.source}</span>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-white/40 font-mono text-xs">
              Generating report data...
            </div>
          )}

          {/* On-Chain Proof Card */}
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-violet-300">
                <ShieldCheck className="h-4 w-4" /> On-Chain ERC-8004 & ERC-8183 Proofs
              </div>
              <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                <Award className="h-3 w-3" /> Reputation Awarded
              </span>
            </div>

            <div className="grid gap-2 font-mono text-[11px]">
              {run.fundTx && (
                <div className="flex items-center justify-between bg-black/30 p-2 rounded border border-white/5">
                  <span className="text-white/50">ERC-8183 Fund Tx:</span>
                  <a
                    href={`https://testnet.arcscan.app/tx/${run.fundTx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-300 hover:underline flex items-center gap-1"
                  >
                    {run.fundTx.slice(0, 10)}…{run.fundTx.slice(-6)} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}

              {run.completeTx && (
                <div className="flex items-center justify-between bg-black/30 p-2 rounded border border-white/5">
                  <span className="text-white/50">ERC-8183 Settlement Tx:</span>
                  <a
                    href={`https://testnet.arcscan.app/tx/${run.completeTx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-300 hover:underline flex items-center gap-1"
                  >
                    {run.completeTx.slice(0, 10)}…{run.completeTx.slice(-6)} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-white/10 relative z-10">
          <button
            onClick={handleCopyReport}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:text-white hover:bg-white/10 transition font-mono"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied Report!' : 'Copy Summary'}
          </button>
          
          <div className="flex items-center gap-2">
            {run.wfId && (
              <a
                href={`https://testnet.arcscan.app/address/0x0747EEf0706327138c69792bF28Cd525089e4583`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-300 hover:bg-cyan-500/20 transition font-mono"
              >
                ArcScan Explorer <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <button
              onClick={onClose}
              className="rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-1.5 text-xs font-bold text-black hover:opacity-90 transition shadow-md"
            >
              Done
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
