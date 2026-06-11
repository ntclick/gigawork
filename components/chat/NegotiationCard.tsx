import React from 'react'
import { CheckCircle2, Loader2, Send, XCircle } from 'lucide-react'
import { getEndpointConfig } from '@/lib/nanopayments/config'

type State = 'input-streaming' | 'input-available' | 'output-available' | 'output-error'

export const NegotiationCard = React.memo(function NegotiationCard({
  state,
  skillName,
  input,
  output,
  errorText,
}: {
  state: State
  skillName?: string
  input?: Record<string, unknown>
  output?: { ok?: boolean; output?: unknown; error?: string }
  errorText?: string
}) {
  const running = state === 'input-streaming' || state === 'input-available'
  const failed = state === 'output-error' || (output && output.ok === false)
  const done = !running && !failed && state === 'output-available'
  
  // Deterministic mock L1 wallet address based on skillName for Web3 realism
  const mockAddr = (() => {
    if (!skillName) return '0x0000...0000'
    let hash = 0
    for (let i = 0; i < skillName.length; i++) {
      hash = skillName.charCodeAt(i) + ((hash << 5) - hash)
    }
    const hex = Math.abs(hash).toString(16).slice(0, 8).padStart(8, '0')
    return `0x${hex.slice(0, 4)}...${hex.slice(-4)}`
  })()

  // Get actual USDC price from config
  const price = skillName ? (getEndpointConfig(skillName)?.priceUsdc ?? '—') : '—'

  const tone = failed
    ? 'border-red-500/30 bg-red-500/5 text-red-200'
    : running
      ? 'border-cyan-400/30 bg-cyan-400/5 text-cyan-200'
      : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'

  const label = failed 
    ? 'Task failed' 
    : running 
      ? 'Escrow locked & Activated' 
      : 'Verification complete'
      
  const Icon = failed ? XCircle : running ? Loader2 : CheckCircle2
  const iconClass = failed
    ? 'h-4 w-4 text-red-300'
    : running
      ? 'h-4 w-4 animate-spin text-cyan-300'
      : 'h-4 w-4 text-emerald-300'

  return (
    <div className={`gw-fade-in my-2.5 rounded-2xl border ${tone} px-4 py-3 transition shadow-lg`}>
      <div className="flex items-center gap-2">
        <Icon className={iconClass} />
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className={`font-bold ${done ? 'text-emerald-300' : 'text-white/85'}`}>{label}</span>
          {skillName && (
            <>
              <Send className="h-2.5 w-2.5 text-white/30" />
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-cyan-200/90 flex items-center gap-1">
                <span>{skillName}</span>
                <span className="text-[7px] opacity-60 hover:underline hover:text-cyan-300 transition-colors ml-1 font-mono">{mockAddr}</span>
              </span>
            </>
          )}
          {running && (
            <span className="gw-typing ml-1">
              <span /><span /><span />
            </span>
          )}
        </span>
        <span className="ml-auto text-[7px] font-mono font-bold px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">ERC-8004</span>
      </div>

      {input && Object.keys(input).length > 0 && (
        <details className="mt-2.5 group">
          <summary className="cursor-pointer text-[9px] uppercase tracking-widest text-white/40 hover:text-white/70 select-none">
            [+] Input Data
          </summary>
          <pre className="mt-1.5 overflow-x-auto rounded-lg bg-black/40 p-2.5 text-[10px] leading-relaxed text-white/55 border border-white/5 font-mono">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      )}

      {output?.output != null && (
        <details className="mt-2 group" open={done}>
          <summary className="cursor-pointer text-[9px] uppercase tracking-widest text-white/40 hover:text-white/70 select-none">
            [+] Output Data
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-black/40 p-2.5 text-[10px] leading-relaxed text-white/65 border border-white/5 font-mono">
            {JSON.stringify(output.output, null, 2)}
          </pre>
        </details>
      )}

      {(output?.error || errorText) && (
        <div className="mt-2.5 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300 leading-normal">
          {output?.error ?? errorText}
        </div>
      )}

      {/* USDC Escrow Flow indicators (ERC-8183 escrow) */}
      <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between font-mono text-[9px] select-none">
        <div className="flex items-center gap-1.5">
          <span className="text-white/40">Escrow:</span>
          <span className={`font-extrabold tracking-wide ${done ? 'text-emerald-400' : failed ? 'text-red-400' : 'text-cyan-300'}`}>
            {price !== '—' ? `${price} USDC` : '—'} {done ? '✓ (Released)' : failed ? '🔓 (Refunded)' : '🔒 (Locked)'}
          </span>
        </div>
        <span className="text-[8px] text-white/30 uppercase tracking-widest">ERC-8183 Escrow</span>
      </div>
    </div>
  )
})
