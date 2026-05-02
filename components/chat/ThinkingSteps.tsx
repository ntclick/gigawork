'use client'

import { Check, Loader2, Sparkles } from 'lucide-react'

export type ThinkStep = {
  id: string
  label: string
  detail?: string
  status: 'running' | 'done'
}

export function ThinkingSteps({
  steps,
  durationMs,
  sources,
}: {
  steps: ThinkStep[]
  durationMs?: number
  sources?: number
}) {
  if (steps.length === 0) return null
  return (
    <div className="gw-fade-in gw-gradient-border my-2 rounded-xl p-px">
      <div className="rounded-xl bg-[#0f131c]/85 px-3 py-2.5">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-cyan-300/85">
          <Sparkles className="h-3 w-3" />
          <span className="font-medium">Đang phân tích…</span>
          {durationMs != null && (
            <span className="ml-auto rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-white/55">
              {(durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {sources != null && sources > 0 && (
            <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-white/55">
              {sources} nguồn
            </span>
          )}
        </div>
        <ul className="flex flex-col gap-1.5">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5">
                {s.status === 'done' ? (
                  <Check className="h-3 w-3 text-emerald-300" />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin text-cyan-300" />
                )}
              </span>
              <span className="flex-1 text-white/80">
                {s.label}
                {s.detail && (
                  <span className="ml-2 text-[10px] text-white/45">{s.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
