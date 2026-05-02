import { Sparkles } from 'lucide-react'

export function BrainMessage({
  text,
  streaming,
  thinking,
}: {
  text: string
  streaming?: boolean
  thinking?: boolean
}) {
  if (!text.trim() && !streaming) return null

  if (thinking) {
    return (
      <div className="gw-slide-in-left flex items-start gap-3">
        <HermesAvatar />
        <div className="flex-1 pt-1">
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-400/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300/85">
            <span className="gw-pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-cyan-300" />
            Hermes thinking
          </div>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-cyan-100/85">
            {text}
            {streaming && <span className="ml-0.5 inline-block h-3.5 w-[6px] -translate-y-px animate-pulse bg-cyan-300/80 align-middle" />}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="gw-slide-in-left flex items-start gap-3">
      <HermesAvatar />
      <div className="max-w-[88%] whitespace-pre-wrap pt-1 text-sm leading-relaxed text-white/88">
        {text}
        {streaming && <span className="ml-0.5 inline-block h-3.5 w-[6px] -translate-y-px animate-pulse bg-cyan-300/80 align-middle" />}
      </div>
    </div>
  )
}

function HermesAvatar() {
  return (
    <div className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-gradient-to-br from-cyan-400/15 to-purple-400/10 shadow-[0_0_14px_rgba(34,211,238,0.18)]">
      <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
      <span className="gw-pulse-soft absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-[#0b0e15] bg-emerald-400" />
    </div>
  )
}
