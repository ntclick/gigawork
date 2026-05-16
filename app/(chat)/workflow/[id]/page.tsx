'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'

import { WorkflowCanvas } from '@/components/chat/WorkflowCanvas'
import { WorkflowDocPanel } from '@/components/chat/WorkflowDocPanel'
import { AppRail } from '@/components/shell/AppRail'
import { MainHeader } from '@/components/shell/MainHeader'
import { useEscrowPost } from '@/lib/hooks/useEscrowPost'
import { useValidationAttest } from '@/lib/hooks/useValidationAttest'
import { toast } from '@/components/ui/toast'

type Erc8183Trail = {
  jobId: string | null
  createTx: string | null
  setBudgetTx: string | null
  approveTx: string | null
  fundTx: string | null
  submitTx: string | null
  completeTx: string | null
  deliverableHash: string | null
  budgetUsdc: string | null
}

type Snapshot = {
  workflow: { id: string; prompt: string; status: string; erc8183?: Erc8183Trail | null }
  messages: UIMessage[]
  isFinished: boolean
}

export default function WorkflowPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const autoSentRef = useRef(false)
  const autoEscrowRef = useRef<string | null>(null)
  const startRef = useRef<number | undefined>(undefined)
  const escrow = useEscrowPost()
  const postEscrow = escrow.post
  const validate = useValidationAttest()

  const { messages, sendMessage, setMessages, status } = useChat({
    transport: new DefaultChatTransport({ api: `/api/workflow/${id}/stream` }),
    onFinish: ({ message }) => {
      window.dispatchEvent(new CustomEvent('gw:credits-changed'))
      // settleJob fires admin-side from finalizeReport once the brain emits
      // the report tool. The submit/complete tx hashes write to DB ~1s after
      // onFinish here. Re-fetch snapshot once shortly after to pick up the
      // new tx hashes for the ERC-8183 trail panel without forcing a reload.
      setTimeout(() => {
        fetch(`/api/workflow/${id}/messages`)
          .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
          .then((j: Snapshot) => setSnapshot(j))
          .catch(() => {})
      }, 2500)
      // Surface non-stop finish reasons as warning. (finishReason is on the
      // streaming chunk, not the final message — we just signal completion.)
      const text = (message.parts ?? [])
        .map((p) => (p.type === 'text' && 'text' in p ? p.text : ''))
        .join('')
      if (text && text.length < 80 && /fail|error|unable|cannot/i.test(text)) {
        toast.warning('Workflow ended early', text)
      }
    },
    onError: (err) => {
      toast.error('Stream lỗi', err instanceof Error ? err.message : String(err))
    },
  })

  // Scan tool results for failures and emit one toast per failure.
  // Dedup with a ref so re-renders don't re-fire.
  const seenErrorsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const m of messages) {
      for (const part of m.parts ?? []) {
        if (
          typeof part === 'object' &&
          part !== null &&
          'type' in part &&
          typeof (part as { type: string }).type === 'string' &&
          (part as { type: string }).type.startsWith('tool-')
        ) {
          const p = part as {
            type: string
            state?: string
            toolCallId?: string
            output?: unknown
          }
          if (p.state !== 'output-available') continue
          const out = p.output as { ok?: boolean; error?: string; skill_name?: string } | undefined
          if (!out || out.ok !== false) continue
          const key = `${p.toolCallId}:${out.error ?? 'fail'}`
          if (seenErrorsRef.current.has(key)) continue
          seenErrorsRef.current.add(key)
          const skill = out.skill_name ?? p.type.replace(/^tool-/, '')
          toast.error(`Skill failed: ${skill}`, out.error)
        }
      }
    }
  }, [messages])

  // Hydrate from DB so reload preserves the canvas + doc panel.
  // We also re-fetch when the stream finishes (status transitions to 'idle')
  // so that the ERC-8183 trail picks up the Submit/Complete transaction hashes.
  useEffect(() => {
    if (!id || status === 'streaming' || status === 'submitted') return
    let cancelled = false
    fetch(`/api/workflow/${id}/messages`)
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then((j: Snapshot) => {
        if (cancelled) return
        setSnapshot(j)
        // Only set initial messages if we don't have them yet, so we don't
        // overwrite the UI state with stale DB state during a live chat.
        if (j.messages.length > 0 && messages.length === 0) setMessages(j.messages)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, status, setMessages, messages.length])

  // Auto-send only when this workflow has never streamed.
  // Includes retry logic for race condition where DB status is still
  // 'funding' when the page mounts (confirm endpoint may still be writing).
  const autoSendPollRef = useRef(0)
  useEffect(() => {
    if (autoSentRef.current || !snapshot) return
    const hasAssistant = snapshot.messages.some((m) => m.role === 'assistant')
    const hasPlan = snapshotHasPlan(snapshot)
    const waitingForEscrow =
      snapshot.workflow?.status === 'awaiting_fund' || snapshot.workflow?.status === 'funding'

    if (
      snapshot.workflow?.status === 'planning' &&
      !snapshot.isFinished &&
      !waitingForEscrow &&
      !hasAssistant &&
      !hasPlan &&
      snapshot.workflow.prompt
    ) {
      autoSentRef.current = true
      autoSendPollRef.current = 0
      startRef.current = Date.now()
      sendMessage({ text: snapshot.workflow.prompt })
      return
    }

    // Race condition recovery: if status is still 'funding' but we navigated
    // here right after escrow completed, poll a few times for 'planning'.
    if (waitingForEscrow && !hasAssistant && !hasPlan && autoSendPollRef.current < 6) {
      autoSendPollRef.current += 1
      const timer = setTimeout(() => {
        fetch(`/api/workflow/${id}/messages`, { cache: 'no-store' })
          .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
          .then((j: Snapshot) => {
            setSnapshot(j)
            if (j.messages.length > 0 && messages.length === 0) setMessages(j.messages)
          })
          .catch(() => {})
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [snapshot, sendMessage, id, setMessages, messages.length])

  const busy = status === 'streaming' || status === 'submitted'
  const displayStatus = busy ? status : snapshot?.workflow?.status ?? status
  const needsEscrow =
    !busy &&
    !!snapshot &&
    !snapshot.messages.some((m) => m.role === 'assistant') &&
    (snapshot.workflow?.status === 'awaiting_fund' ||
      snapshot.workflow?.status === 'funding')
  const title = snapshot?.workflow?.prompt
    ? truncate(snapshot.workflow.prompt, 40)
    : `Workflow ${id.slice(0, 8)}`

  const runEscrowFunding = useCallback(async () => {
    try {
      await postEscrow(id)
      const res = await fetch(`/api/workflow/${id}/messages`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`messages API ${res.status}`)
      const fresh = (await res.json()) as Snapshot
      setSnapshot(fresh)
      if (fresh.messages.length > 0) setMessages(fresh.messages)
      const shouldStartHermes =
        fresh.workflow?.status === 'planning' &&
        !fresh.isFinished &&
        !snapshotHasPlan(fresh) &&
        fresh.workflow.prompt
      autoSentRef.current = !shouldStartHermes
      if (shouldStartHermes) {
        sendMessage({ text: fresh.workflow.prompt })
        autoSentRef.current = true
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (/huỷ ký|user rejected|denied/i.test(message)) {
        // User-cancel is expected behavior — show a softer message and
        // skip the snapshot reload (state didn't change on-chain).
        toast.warning('Bạn đã huỷ ký', 'Click "Retry" để mở lại popup ký.')
        return
      }
      if (/still pending|pending on Arc|not mined yet/i.test(message)) {
        toast.warning('Escrow tx pending', message)
      } else {
        toast.error('Escrow funding required', message)
      }
      const errRes = await fetch(`/api/workflow/${id}/messages`, { cache: 'no-store' })
      if (!errRes.ok) return
      const fresh = (await errRes.json()) as Snapshot
      setSnapshot(fresh)
    }
  }, [id, postEscrow, sendMessage, setMessages])

  // When the page mounts on a completed workflow, do two things in
  // background:
  //   1. Run validation reconciliation — picks up any
  //      `validationRequest` the user signed in a previous session
  //      that's still missing the admin's `validationResponse`.
  //   2. Probe /prepare to count how many proofs the user still owes
  //      a popup for. Drives the visibility of the "Sign Proofs" strip
  //      so users whose wallet doesn't own any skill agents (the common
  //      case — skills are platform-managed) never see the CTA.
  //
  // Both are fire-and-forget + idempotent. Server-side validation is
  // the source of truth; UI is a hint.
  const reconcileRanRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      !snapshot ||
      snapshot.workflow?.status !== 'completed' ||
      reconcileRanRef.current === id
    ) {
      return
    }
    reconcileRanRef.current = id
    fetch(`/api/workflow/${id}/validation/reconcile`, { method: 'POST' })
      .then(() => validate.probe(id))
      .catch(() => {
        // Even if reconcile errors, probe directly to drive the strip.
        validate.probe(id).catch(() => {})
      })
  }, [snapshot, id, validate])

  // Auto-fire disabled — popups were jumping on the user before the
  // Privy wallets[] had hydrated and before the user had even seen the
  // page. The funding overlay below still renders when needsEscrow is
  // true; the user clicks the explicit "Continue funding" button to
  // open the wallet popup on their schedule.
  void autoEscrowRef // ref kept so existing reset logic compiles

  return (
    <>
      {/* Top header — always visible */}
      <MainHeader />

      {/* Main shell: thin AppRail · canvas · doc panel */}
      <div className="giga-theme flex flex-1 overflow-hidden bg-[var(--giga-dark)]">
        <AppRail />

        {/* CANVAS COLUMN */}
        <main className="relative flex flex-1 flex-col overflow-hidden bg-[var(--giga-dark)]">
          {/* Workflow header */}
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] bg-[#12101f] px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex shrink-0 items-center gap-2 rounded border border-[var(--giga-accent)]/30 bg-[var(--giga-accent)]/10 px-2 py-1">
                <span className={`h-2 w-2 rounded-full bg-[var(--giga-accent)] ${busy ? 'animate-pulse' : ''}`} />
                <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--giga-accent)]">
                  Hermes Orchestrator
                </span>
              </div>
              <h1 className="font-pixel-body inline truncate text-xl uppercase text-white sm:text-2xl lg:text-3xl">
                {title}
              </h1>
            </div>
            <button
              type="button"
              className="pixel-border-sm flex shrink-0 items-center gap-2 bg-[var(--giga-accent)] px-4 py-2 font-pixel-body text-base text-black transition hover:bg-yellow-300 sm:px-6 sm:text-xl"
            >
              <span className="text-sm">📉</span>
              <span className="hidden sm:inline">DEPLOY</span>
            </button>
          </div>

          {/* Canvas */}
          <div className="giga-grid-bg relative flex-1 overflow-hidden">
            <WorkflowCanvas
              messages={messages}
              status={displayStatus}
              workflowId={id}
              erc8183={snapshot?.workflow?.erc8183 ?? null}
              onEditNode={(req) => {
                if (busy) {
                  toast.warning('Hermes is running', 'Wait for the current step to finish before editing.')
                  return
                }
                const envelope =
                  `[EDIT_NODE id=${req.nodeId} original_skill=${req.originalSkill} new_skill=${req.newSkill}]\n` +
                  `input_json: ${req.inputJson}\n` +
                  (req.note ? `\nUser note: ${req.note}\n` : '') +
                  `\nRe-run this single step with the values above. ` +
                  `Use dispatchSkill('${req.newSkill}', input=input_json verbatim). ` +
                  `Then update finalizeReport with the new output replacing the old one.`
                sendMessage({ text: envelope })
              }}
            />
            {busy && (
              <div className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-2 border-2 border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 px-3 py-1.5 text-xs font-pixel-body">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--giga-accent)]" />
                <span className="text-[var(--giga-accent)]">Hermes is orchestrating…</span>
              </div>
            )}
            {/* Compact retry strip — shown when escrow is in error/idle
                with an error message. Auto-fire only runs once per workflow
                so we need this for the user-cancel + transient-failure
                cases (user rejects popup, RPC blip, etc.). The right-side
                ERC-8183 Trail panel still shows full progress. */}
            {needsEscrow && (escrow.step === 'error' || (escrow.step === 'idle' && !!escrow.error)) && (
              <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 inline-flex max-w-[90%] -translate-x-1/2 items-center gap-2 border border-[var(--giga-accent)]/30 bg-[#12101f]/95 px-3 py-2 text-xs text-white/80 shadow-[0_8px_20px_rgba(0,0,0,0.3)]">
                <span className="text-[var(--giga-accent)]">Escrow not funded</span>
                <span className="text-white/40">·</span>
                <span className="truncate text-white/60">{escrow.error ?? 'Sign required'}</span>
                <button
                  type="button"
                  onClick={() => {
                    escrow.reset()
                    autoEscrowRef.current = null // allow auto-fire to re-run
                    runEscrowFunding().catch(() => {})
                  }}
                  className="ml-1 inline-flex items-center bg-[var(--giga-accent)] px-2 py-1 font-pixel-body text-[10px] uppercase text-black transition hover:bg-yellow-300"
                >
                  Retry
                </button>
              </div>
            )}
            {/* Agent Proofs CTA — shown only once the workflow is fully
                settled. Validation requires user-side popups (ownership-
                gated), so we make it an explicit click instead of auto-
                firing. After all agents are attested, the strip auto-
                hides. */}
            {!busy &&
              snapshot?.workflow?.status === 'completed' &&
              validate.step !== 'done' &&
              validate.pendingCount > 0 && (
                <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 inline-flex max-w-[90%] -translate-x-1/2 items-center gap-2 border border-cyan-400/30 bg-[#12101f]/95 px-3 py-2 text-xs text-white/80 shadow-[0_8px_20px_rgba(0,0,0,0.3)]">
                  <span className="text-cyan-300">Agent Proofs</span>
                  <span className="text-white/40">·</span>
                  <span className="text-white/60">
                    {validate.step === 'preparing' && 'Preparing…'}
                    {validate.step === 'signing' && 'Sign in wallet…'}
                    {validate.step === 'responding' && 'Server attesting…'}
                    {validate.step === 'error' && (validate.error ?? 'Failed')}
                    {validate.step === 'idle' &&
                      'Sign on-chain proof for each skill agent (ERC-8004)'}
                  </span>
                  <button
                    type="button"
                    disabled={
                      validate.step === 'preparing' ||
                      validate.step === 'signing' ||
                      validate.step === 'responding'
                    }
                    onClick={() => validate.attest(id).catch(() => {})}
                    className="ml-1 inline-flex items-center bg-cyan-400 px-2 py-1 font-pixel-body text-[10px] uppercase text-black transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {validate.step === 'idle' && 'Sign proofs'}
                    {validate.step !== 'idle' &&
                      validate.step !== 'error' &&
                      `${validate.items.filter((i) => i.status === 'done').length}/${validate.items.length}`}
                    {validate.step === 'error' && 'Retry'}
                  </button>
                </div>
              )}
          </div>

          {/* Bottom prompt bar */}
          <BottomPromptBar busy={busy} onSend={(text) => sendMessage({ text })} />
        </main>

        {/* RIGHT DOC PANEL */}
        <WorkflowDocPanel
          title={title}
          prompt={snapshot?.workflow?.prompt}
          messages={messages}
          status={displayStatus}
          erc8183={snapshot?.workflow?.erc8183 ?? null}
        />
      </div>
    </>
  )
}

function BottomPromptBar({ busy, onSend }: { busy: boolean; onSend: (text: string) => void }) {
  const [v, setV] = useState('')
  const send = () => {
    const t = v.trim()
    if (!t || busy) return
    onSend(t)
    setV('')
  }
  return (
    <div className="bg-[var(--giga-dark)] p-4 sm:p-6">
      <div className="flex items-end gap-2 border border-[#3e3b5e] bg-[var(--giga-panel)] p-3 transition-colors focus-within:border-purple-500">
        <textarea
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={busy ? 'Hermes is orchestrating… (wait before refining)' : 'Refine this workflow with a prompt…'}
          disabled={busy}
          rows={1}
          className="font-pixel-body min-h-[2.25rem] flex-1 resize-none bg-transparent text-base text-white outline-none placeholder:text-gray-400 disabled:cursor-not-allowed sm:text-xl"
          style={{ fontFamily: 'inherit' }}
        />
        <button
          onClick={send}
          disabled={busy || !v.trim()}
          aria-label="Send"
          className="pixel-border-sm inline-flex h-9 w-9 shrink-0 items-center justify-center bg-[var(--giga-accent)] text-black transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function snapshotHasPlan(snapshot: Snapshot) {
  return snapshot.messages.some((m) =>
    m.parts?.some(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type?: string }).type === 'tool-planWorkflow',
    ),
  )
}
