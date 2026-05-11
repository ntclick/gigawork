'use client'

import { useEffect, useRef } from 'react'
import { isToolUIPart, type UIMessage } from 'ai'

import { BrainMessage } from './BrainMessage'
import { MiniDag } from './MiniDag'
import { NegotiationCard } from './NegotiationCard'
import { ReportCard } from './ReportCard'
import { UserMessage } from './UserMessage'

export function Thread({ messages }: { messages: UIMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  return (
    <div className="flex flex-col gap-5 px-4 py-6 md:px-6">
      {messages.length === 0 && <ThinkingPlaceholder />}
      {messages.map((m) => (
        <div key={m.id} className="flex flex-col gap-2">
          {m.parts.map((part, i) => {
            const k = `${m.id}-${i}`

            if (part.type === 'text') {
              return m.role === 'user' ? (
                <UserMessage key={k} text={part.text} />
              ) : (
                <BrainMessage key={k} text={part.text} />
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
                if (state === 'output-available') {
                  const out = part.output as
                    | { nodes?: Array<{
                        node_id: string
                        plan_id: string
                        label: string
                        skill_name: string
                        depends_on: string[]
                      }> }
                    | undefined
                  if (out?.nodes?.length) {
                    return <MiniDag key={k} nodes={out.nodes} />
                  }
                }
                return <SkeletonRow key={k} label="Planning workflow…" />
              }

              if (toolName === 'dispatchSkill') {
                const input = (part.input as Record<string, unknown> | undefined) ?? {}
                const skillName = (input.skill_name as string | undefined) ?? '—'
                const output =
                  state === 'output-available'
                    ? (part.output as {
                        ok?: boolean
                        output?: unknown
                        error?: string
                      })
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

              if (toolName === 'finalizeReport') {
                if (state === 'output-available') {
                  const input = (part.input as
                    | { summary_markdown?: string; raw_json?: Record<string, unknown> }
                    | undefined) ?? {}
                  const output = (part.output as { summary_markdown?: string } | undefined) ?? {}
                  return (
                    <ReportCard
                      key={k}
                      summary={output.summary_markdown ?? input.summary_markdown ?? ''}
                      raw={input.raw_json ?? {}}
                    />
                  )
                }
                return <SkeletonRow key={k} label="Composing report…" />
              }
            }

            return null
          })}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

function SkeletonRow({ label }: { label: string }) {
  return (
    <div className="gw-fade-in my-1 flex items-center gap-2 text-xs text-cyan-300/70">
      <span className="gw-spinner h-3 w-3" />
      {label}
    </div>
  )
}

function ThinkingPlaceholder() {
  return (
    <div className="gw-fade-in flex items-center gap-2 text-xs text-white/40">
      <span className="gw-typing">
        <span /><span /><span />
      </span>
      Connecting to the brain…
    </div>
  )
}
