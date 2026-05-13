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
          .then((r) => r.json())
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
      .then((r) => r.json())
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

  // Auto-send only when this workflow has never streamed
  useEffect(() => {
    if (autoSentRef.current || !snapshot) return
    const hasAssistant = snapshot.messages.some((m) => m.role === 'assistant')
    const hasPlan = snapshotHasPlan(snapshot)
    const waitingForEscrow =
      snapshot.workflow.status === 'awaiting_fund' || snapshot.workflow.status === 'funding'
    if (
      snapshot.workflow.status === 'planning' &&
      !snapshot.isFinished &&
      !waitingForEscrow &&
      !hasAssistant &&
      !hasPlan &&
      snapshot.workflow.prompt
    ) {
      autoSentRef.current = true
      startRef.current = Date.now()
      sendMessage({ text: snapshot.workflow.prompt })
    }
  }, [snapshot, sendMessage])

  const busy = status === 'streaming' || status === 'submitted'
  const displayStatus = busy ? status : snapshot?.workflow.status ?? status
  const needsEscrow =
    !busy &&
    !!snapshot &&
    !snapshot.messages.some((m) => m.role === 'assistant') &&
    (snapshot.workflow.status === 'awaiting_fund' ||
      snapshot.workflow.status === 'funding')
  const title = snapshot?.workflow.prompt
    ? truncate(snapshot.workflow.prompt, 40)
    : `Workflow ${id.slice(0, 8)}`

  const runEscrowFunding = useCallback(async () => {
    try {
      await postEscrow(id)
      const fresh = (await fetch(`/api/workflow/${id}/messages`, { cache: 'no-store' }).then((r) =>
        r.json(),
      )) as Snapshot
      setSnapshot(fresh)
      if (fresh.messages.length > 0) setMessages(fresh.messages)
      const shouldStartHermes =
        fresh.workflow.status === 'planning' &&
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
      if (/still pending|pending on Arc|not mined yet/i.test(message)) {
        toast.warning('Escrow tx pending', message)
      } else {
        toast.error('Escrow funding required', message)
      }
      const fresh = (await fetch(`/api/workflow/${id}/messages`, { cache: 'no-store' }).then((r) =>
        r.json(),
      )) as Snapshot
      setSnapshot(fresh)
    }
  }, [id, postEscrow, sendMessage, setMessages])

  useEffect(() => {
    if (!needsEscrow || !snapshot || escrow.step !== 'idle') return
    if (autoEscrowRef.current === id) return
    autoEscrowRef.current = id
    void runEscrowFunding()
  }, [escrow.step, id, needsEscrow, runEscrowFunding, snapshot])

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
              erc8183={snapshot?.workflow.erc8183 ?? null}
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
            {needsEscrow && (
              <WorkflowEscrowOverlay
                erc8183={snapshot.workflow.erc8183 ?? null}
                step={escrow.step}
                error={escrow.error}
                txHashes={escrow.txHashes}
                onContinue={runEscrowFunding}
              />
            )}
          </div>

          {/* Bottom prompt bar */}
          <BottomPromptBar busy={busy} onSend={(text) => sendMessage({ text })} />
        </main>

        {/* RIGHT DOC PANEL */}
        <WorkflowDocPanel
          title={title}
          prompt={snapshot?.workflow.prompt}
          messages={messages}
          status={displayStatus}
          erc8183={snapshot?.workflow.erc8183 ?? null}
        />
      </div>
    </>
  )
}

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

function WorkflowEscrowOverlay({
  erc8183,
  step,
  error,
  txHashes,
  onContinue,
}: {
  erc8183: Erc8183Trail | null
  step: ReturnType<typeof useEscrowPost>['step']
  error: string | null
  txHashes: ReturnType<typeof useEscrowPost>['txHashes']
  onContinue: () => Promise<void>
}) {
  const [running, setRunning] = useState(false)
  const createTx = txHashes.create ?? erc8183?.createTx ?? undefined
  const approveTx = txHashes.approve ?? erc8183?.approveTx ?? undefined
  const fundTx = txHashes.fund ?? erc8183?.fundTx ?? undefined
  const pendingError = !!error && /still pending|pending on Arc|not mined yet|not visible/i.test(error)
  const current =
    step === 'posting-create'
      ? 'Waiting for createJob confirmation, then provider setBudget'
      : step === 'signing-approve'
        ? 'Approve USDC spend in wallet'
        : step === 'signing-fund'
          ? 'Sign fund escrow in wallet'
          : step === 'confirming'
            ? 'Waiting for fund confirmation'
            : step === 'error'
              ? 'Funding needs attention'
              : 'ERC-8183 funding required before agents run'

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-[var(--giga-accent)]/40 bg-[#12101f] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-pixel-body text-xl uppercase text-white">Fund ERC-8183 escrow</h2>
            <p className="mt-1 text-sm text-white/55">
              Agents will start only after create, approve, and fund are confirmed.
            </p>
          </div>
          <span className="font-mono text-[10px] uppercase text-[var(--giga-accent)]">{step}</span>
        </div>

        <div className="mb-4 border border-cyan-400/20 bg-cyan-400/[0.04] p-3 text-sm text-cyan-100">
          {current}
        </div>

        <div className="space-y-2 text-sm">
          <EscrowStepRow label="Create job" tx={createTx} done={!!erc8183?.jobId} active={(!!createTx && !erc8183?.jobId) || step === 'posting-create'} note={createTx && !erc8183?.jobId ? 'submitted' : undefined} />
          <EscrowStepRow label="Set budget" tx={erc8183?.setBudgetTx ?? undefined} done={!!erc8183?.setBudgetTx} />
          <EscrowStepRow label="Approve USDC" tx={approveTx === '0x0' ? undefined : approveTx} done={!!fundTx || step === 'done'} active={(!!approveTx && !fundTx) || step === 'signing-approve' || step === 'confirming'} note={approveTx === '0x0' ? 'allowance ok' : approveTx && !fundTx ? 'submitted' : undefined} />
          <EscrowStepRow label="Fund escrow" tx={fundTx} done={!!fundTx} active={step === 'signing-fund' || step === 'confirming'} note={fundTx && step !== 'done' ? 'submitted' : undefined} />
        </div>

        {error && (
          <div
            className={`mt-4 border p-3 text-sm ${
              pendingError
                ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
                : 'border-red-400/30 bg-red-500/10 text-red-200'
            }`}
          >
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={running}
          onClick={async () => {
            setRunning(true)
            try {
              await onContinue()
            } finally {
              setRunning(false)
            }
          }}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 bg-[var(--giga-accent)] px-4 py-3 font-pixel-body text-lg text-black transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? <span className="gw-spinner h-4 w-4" /> : null}
          {running ? 'Processing escrow...' : 'Continue funding'}
        </button>
      </div>
    </div>
  )
}

function EscrowStepRow({
  label,
  tx,
  done,
  active,
  note,
}: {
  label: string
  tx?: string
  done?: boolean
  active?: boolean
  note?: string
}) {
  return (
    <div className="flex items-center gap-2 border border-white/10 bg-black/20 px-3 py-2">
      <span className={`h-2 w-2 rounded-full ${done ? 'bg-emerald-300' : active ? 'animate-pulse bg-[var(--giga-accent)]' : 'bg-white/20'}`} />
      <span className={done ? 'text-white/85' : active ? 'text-[var(--giga-accent)]' : 'text-white/45'}>{label}</span>
      <span className="ml-auto font-mono text-[10px]">
        {tx ? (
          <a href={`${EXPLORER}/tx/${tx}`} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 hover:underline">
            {tx.slice(0, 8)}...{tx.slice(-4)}
          </a>
        ) : note ? (
          <span className="text-white/35">{note}</span>
        ) : (
          <span className="text-white/25">pending</span>
        )}
      </span>
    </div>
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
