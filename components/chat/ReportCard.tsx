'use client'

import { useState } from 'react'
import { Check, Copy, FileJson, ScrollText } from 'lucide-react'

import { MarkdownTypewriter } from './Typewriter'

export function ReportCard({
  summary,
  raw,
}: {
  summary: string
  raw: Record<string, unknown>
}) {
  const [copied, setCopied] = useState<'md' | 'json' | null>(null)
  const [showJson, setShowJson] = useState(false)

  const copy = async (kind: 'md' | 'json') => {
    const text = kind === 'md' ? summary : JSON.stringify(raw, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1500)
    } catch {}
  }

  return (
    <div className="gw-fade-in gw-gradient-border my-4 rounded-2xl p-px">
      <div className="rounded-2xl bg-[#0f131c]/85 p-5 backdrop-blur">
        <div className="mb-3 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-cyan-300/85">
          <ScrollText className="h-3 w-3" />
          Final report
        </div>

        <MarkdownTypewriter text={summary} />


        <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-3 text-xs">
          <button
            onClick={() => copy('md')}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-white/75 transition hover:border-cyan-400/30 hover:bg-cyan-400/10 hover:text-white"
          >
            {copied === 'md' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied === 'md' ? 'Copied' : 'Markdown'}
          </button>
          <button
            onClick={() => copy('json')}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-white/75 transition hover:border-cyan-400/30 hover:bg-cyan-400/10 hover:text-white"
          >
            {copied === 'json' ? <Check className="h-3 w-3" /> : <FileJson className="h-3 w-3" />}
            {copied === 'json' ? 'Copied' : 'JSON'}
          </button>
          <button
            onClick={() => setShowJson((v) => !v)}
            className="ml-auto text-white/45 transition hover:text-white/80"
          >
            {showJson ? 'Hide raw' : 'Show raw'}
          </button>
        </div>

        {showJson && (
          <pre className="gw-fade-in mt-3 max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-[10px] leading-relaxed text-white/65">
            {JSON.stringify(raw, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
