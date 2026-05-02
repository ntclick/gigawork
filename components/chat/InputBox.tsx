'use client'

import { useState } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'

export function InputBox({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void
  disabled?: boolean
}) {
  const [v, setV] = useState('')

  const send = () => {
    const t = v.trim()
    if (!t || disabled) return
    onSend(t)
    setV('')
  }

  return (
    <div className="sticky bottom-0 mt-6 px-4 pb-4 md:px-6">
      <div className="gw-gradient-border mx-auto max-w-3xl rounded-2xl p-px">
        <div className="flex items-end gap-2 rounded-2xl bg-[#0f131c]/95 px-3 py-2 backdrop-blur">
          <textarea
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={disabled ? 'Brain is thinking…' : 'Reply to the brain…'}
            disabled={disabled}
            rows={1}
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed text-white/90 outline-none placeholder:text-white/30 disabled:cursor-not-allowed"
          />
          <button
            onClick={send}
            disabled={disabled || !v.trim()}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-400/90 text-[#00363d] shadow-[0_0_16px_rgba(34,211,238,0.3)] transition hover:bg-cyan-300 disabled:bg-white/10 disabled:text-white/30 disabled:shadow-none"
          >
            {disabled ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
