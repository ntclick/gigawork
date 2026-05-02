import { CheckCircle2, ExternalLink, Loader2, Send, XCircle, Zap } from 'lucide-react'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

type State = 'input-streaming' | 'input-available' | 'output-available' | 'output-error'

export function NegotiationCard({
  state,
  skillName,
  input,
  output,
  errorText,
}: {
  state: State
  skillName?: string
  input?: Record<string, unknown>
  output?: { ok?: boolean; output?: unknown; error?: string; dispatch_tx?: string | null }
  errorText?: string
}) {
  const running = state === 'input-streaming' || state === 'input-available'
  const failed = state === 'output-error' || (output && output.ok === false)
  const done = !running && !failed && state === 'output-available'
  const txHash = output?.dispatch_tx ?? null

  const tone = failed
    ? 'border-red-400/30 bg-gradient-to-br from-red-500/8 to-red-500/[0.02]'
    : running
      ? 'border-cyan-400/35 bg-gradient-to-br from-cyan-400/8 to-cyan-400/[0.02] gw-breathe'
      : 'border-emerald-400/25 bg-gradient-to-br from-emerald-500/6 to-emerald-500/[0.02]'

  const label = failed ? 'Failed' : running ? 'Dispatching' : 'Done'
  const Icon = failed ? XCircle : running ? Loader2 : CheckCircle2
  const iconClass = failed
    ? 'h-4 w-4 text-red-300'
    : running
      ? 'h-4 w-4 animate-spin text-cyan-300'
      : 'h-4 w-4 text-emerald-300'

  return (
    <div className={`gw-fade-in my-2 rounded-xl border ${tone} px-3.5 py-2.5 transition`}>
      <div className="flex items-center gap-2">
        <Icon className={iconClass} />
        <span className="flex items-center gap-1.5 text-xs">
          <span className="font-medium text-white/85">{label}</span>
          {skillName && (
            <>
              <Send className="h-3 w-3 text-white/30" />
              <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-cyan-200/90">
                {skillName}
              </span>
            </>
          )}
          {running && (
            <span className="gw-typing ml-1.5">
              <span /><span /><span />
            </span>
          )}
        </span>
        {done && !txHash && (
          <Zap className="ml-auto h-3 w-3 text-emerald-300/70" />
        )}
        {txHash && (
          <a
            href={`${EXPLORER}/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-cyan-400/25 bg-cyan-400/[0.06] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-200 transition hover:bg-cyan-400/15"
            title={`Xem giao dịch ERC-8183 trên ArcScan · ${txHash}`}
          >
            <ExternalLink className="h-2.5 w-2.5" />
            8183 tx
          </a>
        )}
      </div>

      {input && Object.keys(input).length > 0 && (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70">
            input
          </summary>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-black/30 p-2 text-[10px] leading-relaxed text-white/55">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      )}

      {output?.output != null && (
        <details className="mt-1.5 group" open={done}>
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70">
            output
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-black/30 p-2 text-[10px] leading-relaxed text-white/65">
            {JSON.stringify(output.output, null, 2)}
          </pre>
        </details>
      )}

      {(output?.error || errorText) && (
        <div className="mt-2 rounded-md border border-red-400/20 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
          {output?.error ?? errorText}
        </div>
      )}
    </div>
  )
}
