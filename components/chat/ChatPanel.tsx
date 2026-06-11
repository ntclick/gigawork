'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { isToolUIPart, type UIMessage } from 'ai'
import { X } from 'lucide-react'

import { BrainMessage } from './BrainMessage'
import { NegotiationCard } from './NegotiationCard'
import { ReportCard } from './ReportCard'
import { ThinkingSteps, type ThinkStep } from './ThinkingSteps'
import { UserMessage } from './UserMessage'
import { useUI } from '../shell/UIShell'

export const ChatPanel = React.memo(function ChatPanel({
  messages,
  status,
  onSend,
  startTime,
}: {
  messages: UIMessage[]
  status: string
  onSend: (text: string) => void
  startTime?: number
}) {
  const [v, setV] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const busy = status === 'streaming' || status === 'submitted'

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [messages])

  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [busy])

  const thinkingSteps = useMemo(() => buildThinkingSteps(messages, busy), [messages, busy])
  const elapsed = startTime && busy ? now - startTime : undefined

  const send = () => {
    const t = v.trim()
    if (!t || busy) return
    onSend(t)
    setV('')
  }

  const { chatOpen, closeChat } = useUI()

  // Auto-close mobile drawer when assistant finishes streaming, so user can see the canvas update.
  // (Removed: would prevent users reading the report. Keep open until user dismisses.)

  const inner = (
    <>
      <div className="flex h-12 items-center gap-2 border-b border-white/5 px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400/30 to-purple-400/20 text-[10px] font-bold text-white/95">
          GW
        </span>
        <span className="text-sm font-medium text-white/85">Brain</span>
        <StatusBadge status={status} />
        <button
          type="button"
          onClick={closeChat}
          aria-label="Close"
          className="md:hidden inline-flex h-7 w-7 items-center justify-center rounded-md text-white/55 hover:text-white hover:bg-white/5"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-4">
            {thinkingSteps.length > 0 && busy && (
              <ThinkingSteps steps={thinkingSteps} durationMs={elapsed} sources={2} />
            )}
            {messages.map((m, mi) => (
              <div key={m.id} className="flex flex-col gap-2">
                {m.parts.map((part, i) => {
                  const k = `${m.id}-${i}`
                  const isLast = mi === messages.length - 1 && i === m.parts.length - 1
                  const partStreaming = busy && isLast && m.role === 'assistant' && part.type === 'text'

                  if (part.type === 'text') {
                    if (m.role === 'user') {
                      return <UserMessage key={k} text={part.text} />
                    }
                    const isThinking =
                      part.text.trimStart().startsWith('▸') ||
                      (partStreaming && part.text.length < 220)
                    return (
                      <BrainMessage
                        key={k}
                        text={part.text}
                        streaming={partStreaming}
                        thinking={isThinking && !part.text.includes('\n\n')}
                      />
                    )
                  }
                  if (isToolUIPart(part)) {
                    const toolName = part.type.replace(/^tool-/, '')
                    const state = part.state as
                      | 'input-streaming'
                      | 'input-available'
                      | 'output-available'
                      | 'output-error'

                    if (toolName === 'planWorkflow') {
                      const out = part.output as
                        | { nodes?: Array<{ label: string; skill_name: string }> }
                        | undefined
                      const count = out?.nodes?.length ?? 0
                      if (state === 'output-available' && count > 0) {
                        return (
                          <div key={k} className="gw-fade-in my-1 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/[0.06] px-3 py-1 text-[11px] text-cyan-200/85 self-start">
                            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                            Plan ready · {count} steps · see canvas →
                          </div>
                        )
                      }
                      return null
                    }

                    if (toolName === 'dispatchSkill') {
                      const input = (part.input as Record<string, unknown> | undefined) ?? {}
                      const skillName = (input.skill_name as string | undefined) ?? '—'
                      const output =
                        state === 'output-available'
                          ? (part.output as { ok?: boolean; output?: unknown; error?: string })
                          : undefined
                      return (
                        <NegotiationCard
                          key={k}
                          state={state}
                          skillName={skillName}
                          input={input.input as Record<string, unknown> | undefined}
                          output={output}
                          errorText={state === 'output-error' ? 'Skill call errored' : undefined}
                        />
                      )
                    }

                    if (toolName === 'finalizeReport' && state === 'output-available') {
                      const input = (part.input as
                        | { summary_markdown?: string; raw_json?: Record<string, unknown> }
                        | undefined) ?? {}
                      const output = (part.output as { summary_markdown?: string } | undefined) ?? {}
                      return (
                        <ReportCard key={k} summary={output.summary_markdown ?? input.summary_markdown ?? ''} raw={input.raw_json ?? {}} />
                      )
                    }
                  }
                  return null
                })}
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-white/5 p-3">
        <div className="gw-gradient-border rounded-xl p-px">
          <div className="flex items-end gap-2 rounded-xl bg-[#0f131c]/95 px-3 py-2">
            <textarea
              value={v}
              onChange={(e) => setV(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder={busy ? 'Brain thinking…' : 'Ask anything about crypto, stocks, and more.'}
              disabled={busy}
              rows={1}
              className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-white/90 outline-none placeholder:text-white/30 disabled:cursor-not-allowed"
            />
            <button
              onClick={send}
              disabled={busy || !v.trim()}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-400/90 text-[#00363d] shadow-[0_0_14px_rgba(34,211,238,0.3)] transition hover:bg-cyan-300 disabled:bg-white/10 disabled:text-white/30 disabled:shadow-none"
              title="Send"
            >
              {busy ? (
                <span className="gw-spinner h-3 w-3" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop: split-view aside, always visible at md+ */}
      <aside className="hidden h-full w-[380px] shrink-0 flex-col border-l border-white/8 bg-[#0b0e15]/70 backdrop-blur md:flex lg:w-[420px]">
        {inner}
      </aside>

      {/* Mobile: drawer triggered by FAB on workflow page */}
      {chatOpen && (
        <>
          <div className="gw-drawer-backdrop md:hidden" onClick={closeChat} role="presentation" />
          <div
            className="gw-drawer-panel gw-drawer-right md:hidden"
            role="dialog"
            aria-label="Brain chat"
          >
            {inner}
          </div>
        </>
      )}
    </>
  )
})

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string; pulse: boolean }> = {
    submitted: { label: 'submitted', tone: 'text-cyan-300', pulse: true },
    streaming: { label: 'streaming', tone: 'text-cyan-300', pulse: true },
    ready: { label: 'idle', tone: 'text-white/45', pulse: false },
    error: { label: 'error', tone: 'text-red-300', pulse: false },
  }
  const m = map[status] ?? { label: status, tone: 'text-white/55', pulse: false }
  return (
    <span className={`ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wider ${m.tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${m.pulse ? 'animate-pulse' : ''}`} />
      {m.label}
    </span>
  )
}

function EmptyState() {
  return (
    <div className="mt-8 flex flex-col items-center text-center text-xs text-white/40">
      <div className="mb-3 h-12 w-12 rounded-full border border-white/10 bg-white/[0.02]" />
      Brain ready. Awaiting first workflow...
    </div>
  )
}

function buildThinkingSteps(messages: UIMessage[], busy: boolean): ThinkStep[] {
  const steps: ThinkStep[] = []
  let hasPlan = false
  let dispatchCount = 0
  let finalized = false

  for (const m of messages) {
    for (const part of m.parts) {
      if (!isToolUIPart(part)) continue
      const toolName = part.type.replace(/^tool-/, '')
      if (toolName === 'planWorkflow' && part.state === 'output-available') hasPlan = true
      if (toolName === 'dispatchSkill' && part.state === 'output-available') dispatchCount++
      if (toolName === 'finalizeReport' && part.state === 'output-available') finalized = true
    }
  }

  steps.push({
    id: 'understand',
    label: 'Understand request',
    status: 'done',
  })
  steps.push({
    id: 'plan',
    label: 'Plan workflow',
    detail: hasPlan ? undefined : 'planning...',
    status: hasPlan ? 'done' : 'running',
  })
  if (hasPlan) {
    steps.push({
      id: 'dispatch',
      label: 'Dispatching to skill agents',
      detail: `${dispatchCount} skill agents dispatched`,
      status: finalized ? 'done' : 'running',
    })
  }
  if (finalized) {
    steps.push({ id: 'final', label: 'Summarizing report', status: 'done' })
  }

  return busy || !finalized ? steps : []
}
