'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'

import { WorkflowCanvas, buildFromMessages } from '@/components/chat/WorkflowCanvas'
import { WorkflowDocPanel } from '@/components/chat/WorkflowDocPanel'
import { WorkflowInteraction } from '@/components/chat/AgentsTheater'
import { NodeDetailSheet, type NodeDetail } from '@/components/chat/NodeDetailSheet'
import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { useEscrowPost } from '@/lib/hooks/useEscrowPost'
import { useValidationAttest } from '@/lib/hooks/useValidationAttest'
import { toast } from '@/components/ui/toast'
import { DeployModal } from '@/components/chat/DeployModal'

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
  reputationTx: string | null
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
  const [isDeployOpen, setIsDeployOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'theater' | 'interaction' | 'canvas'>('theater')
  const [showDocPanel, setShowDocPanel] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [selectedNode, setSelectedNode] = useState<NodeDetail | null>(null)
  const autoSentRef = useRef(false)
  const autoEscrowRef = useRef<string | null>(null)
  const startRef = useRef<number | undefined>(undefined)
  const wallet = useActiveWallet()
  const escrow = useEscrowPost()
  const postEscrow = escrow.post
  const validate = useValidationAttest()

  const { messages, sendMessage, setMessages, status } = useChat({
    transport: new DefaultChatTransport({ api: `/api/workflow/${id}/stream` }),
    onFinish: ({ message }) => {
      window.dispatchEvent(new CustomEvent('gw:credits-changed'))
      // settleJob fires admin-side from finalizeReport once the brain emits
      // the report tool. The submit/complete tx hashes write to DB ~1s after
      // onFinish here. Re-fetch snapshot shortly after and then periodically
      // to pick up the new tx hashes for the ERC-8183 trail panel without forcing a reload.
      const fetchLatest = () => {
        fetch(`/api/workflow/${id}/messages`)
          .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
          .then((j: Snapshot) => {
            setSnapshot(j)
            if (j.workflow?.erc8183?.completeTx) {
              // Successfully received transaction hashes, no further staggered polls needed
              return
            }
          })
          .catch(() => {})
      }
      setTimeout(fetchLatest, 2000)
      setTimeout(fetchLatest, 5000)
      setTimeout(fetchLatest, 10000)
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
      const msg = err instanceof Error ? err.message : String(err)
      // workflow_already_started is expected when revisiting a completed
      // workflow — the auto-send or crash-recovery fires before the
      // snapshot confirms the workflow is finished. Silently ignore.
      if (/workflow_already_started|already running or finished/i.test(msg)) return
      toast.error('Stream error', msg)
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

  const refreshMessages = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/workflow/${id}/messages`)
      if (res.ok) {
        const j = await res.json()
        setSnapshot(j)
        if (j.messages && j.messages.length > 0) {
          setMessages(j.messages)
        }
      }
    } catch (e) {
      console.error('Failed to refresh messages:', e)
    }
  }, [id, setMessages])

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

  // Periodic polling for status and logs during execution or settlement.
  // We poll when the workflow is actively running, settling, or when we have
  // a pending escrow trail that is not fully completed yet.
  useEffect(() => {
    if (!id || status === 'streaming' || status === 'submitted') return
    const completeTx = snapshot?.workflow?.erc8183?.completeTx
    const hasErc8183 = !!snapshot?.workflow?.erc8183
    const isWfCompleted = snapshot?.workflow?.status === 'completed' || snapshot?.workflow?.status === 'failed'
    const isWfSettling = snapshot?.workflow?.status === 'settling'
    const isWfRunning = snapshot?.workflow?.status === 'running' || snapshot?.workflow?.status === 'queued'

    const shouldPoll =
      isWfRunning ||
      isWfSettling ||
      (hasErc8183 && !completeTx && (isWfCompleted || isWfSettling || isWfRunning))

    if (shouldPoll) {
      const interval = setInterval(() => {
        fetch(`/api/workflow/${id}/messages`, { cache: 'no-store' })
          .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
          .then((j: Snapshot) => {
            setSnapshot(j)
            if (j.messages && j.messages.length > 0) {
              setMessages(j.messages)
            }
          })
          .catch(() => {})
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [id, status, snapshot?.workflow?.erc8183?.completeTx, snapshot?.workflow?.erc8183, snapshot?.workflow?.status, setMessages])

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

  // NOTE: Disabled client-side crash recovery hook in GigaWork v2.
  // Under the Plan-First model, the planning stream completes in 1.5s (idle chat status 'ready')
  // while backend execution runs asynchronously. Keeping this hook enabled would falsely trigger
  // recovery (wiping messages and re-submitting planning prompts) every 1.5s during a healthy execution run.
  /*
  const recoverRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      !snapshot ||
      recoverRef.current === id ||
      snapshot.workflow?.status !== 'running' ||
      snapshot.isFinished ||
      status !== 'ready'
    ) {
      return
    }
    recoverRef.current = id
    const timer = setTimeout(() => {
      fetch(`/api/workflow/${id}/messages`, { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null)
        .then((fresh: Snapshot | null) => {
          if (!fresh) return
          if (fresh.isFinished || fresh.workflow?.status === 'completed' || fresh.workflow?.status === 'failed') {
            setSnapshot(fresh)
            if (fresh.messages.length > 0 && messages.length === 0) setMessages(fresh.messages)
            return
          }
          setMessages([])
          autoSentRef.current = true
          startRef.current = Date.now()
          sendMessage({ text: snapshot.workflow!.prompt })
        })
        .catch(() => {})
    }, 1500)
    return () => clearTimeout(timer)
  }, [snapshot, status, id, sendMessage, setMessages, messages.length])
  */

  const { details } = useMemo(() => buildFromMessages(messages), [messages])

  const triggerExecution = useCallback(async () => {
    setExecuting(true)
    try {
      const res = await fetch(`/api/workflow/${id}/execute`, { method: 'POST' })
      if (res.ok) {
        toast.success('Khởi chạy hệ thống Multi-Agent!', 'Các Agent đã bắt đầu tự trị lập luận và xử lý.')
        refreshMessages()
      } else {
        throw new Error(await res.text())
      }
    } catch (e) {
      toast.error('Lỗi khi chạy Workflow', e instanceof Error ? e.message : String(e))
    } finally {
      setExecuting(false)
    }
  }, [id, refreshMessages])

  const busy = status === 'streaming' || status === 'submitted'
  const displayStatus = busy ? status : snapshot?.workflow?.status ?? status
  // Treat the workflow as funded as soon as the fund tx hash is
  // persisted on the row OR the client-side escrow flow reports done.
  // Used to gate any escrow-retry UI surface from showing for an
  // already-paid job whose status flip lagged.
  const fundLanded =
    !!snapshot?.workflow?.erc8183?.fundTx || escrow.step === 'done'
  const needsEscrow =
    !busy &&
    !!snapshot &&
    !fundLanded &&
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
      if (/cancelled|user rejected|denied/i.test(message)) {
        // User-cancel is expected behavior — show a softer message and
        // skip the snapshot reload (state didn't change on-chain).
        toast.warning('Signature cancelled', 'Click "Retry" to open the signing popup again.')
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
      (snapshot.workflow?.status !== 'completed' && snapshot.workflow?.status !== 'failed') ||
      reconcileRanRef.current === id
    ) {
      return
    }
    reconcileRanRef.current = id
    // Reputation reconciliation — fire if no reputationUpdate message exists
    fetch(`/api/workflow/${id}/reputation/reconcile`, { method: 'POST' })
      .then((r) => r.ok ? r.json() : null)
      .then(() => {
        // Re-fetch snapshot AND update useChat messages so Canvas/DocPanel see the result
        fetch(`/api/workflow/${id}/messages`, { cache: 'no-store' })
          .then((r) => { if (r.ok) return r.json(); throw new Error('') })
          .then((j: Snapshot) => {
            setSnapshot(j)
            if (j.messages.length > 0) setMessages(j.messages)
          })
          .catch(() => {})
      })
      .catch(() => {})
    // Validation reconciliation
    fetch(`/api/workflow/${id}/validation/reconcile`, { method: 'POST' })
      .then(() => validate.probe(id))
      .catch(() => {
        validate.probe(id).catch(() => {})
      })
  }, [snapshot, id, validate, setMessages])

  // Auto-resume when the row is stuck at status='funding' with fundTx
  // already persisted. Two-stage recovery:
  //   1. POST /prepare → server reads getJob(jobId).status on chain
  //      and flips status to 'planning' if the job is Funded
  //      (authoritative, no signer checks). This is the c7badf8 path.
  //   2. Fall back to POST /confirm if /prepare didn't advance (legacy
  //      path; required if on-chain status read fails).
  // Refetch snapshot after either succeeds so the funding overlay
  // disappears and the Hermes auto-send effect runs.
  const resumeConfirmRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      !snapshot ||
      resumeConfirmRef.current === id ||
      snapshot.workflow?.status !== 'funding' ||
      !snapshot.workflow.erc8183?.fundTx
    ) {
      return
    }
    resumeConfirmRef.current = id

    const refreshSnapshot = async () => {
      const fresh = await fetch(`/api/workflow/${id}/messages`, {
        cache: 'no-store',
      })
      if (fresh.ok) setSnapshot(await fresh.json())
    }

    ;(async () => {
      try {
        // Stage 1: /prepare auto-advances based on on-chain job status.
        await fetch('/api/workflow/escrow/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId: id }),
        })
        await refreshSnapshot()

        // Re-read latest after refresh. We can't trust closure snapshot.
        const probe = await fetch(`/api/workflow/${id}/messages`, {
          cache: 'no-store',
        })
        if (!probe.ok) return
        const latest = (await probe.json()) as Snapshot
        if (latest.workflow?.status !== 'funding') return

        // Stage 2: still funding → try /confirm with persisted hashes.
        const approveTx = latest.workflow.erc8183?.approveTx ?? '0x0'
        const fundTx = latest.workflow.erc8183?.fundTx
        if (!fundTx) return
        const r = await fetch('/api/workflow/escrow/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflowId: id,
            approveTxHash: approveTx,
            fundTxHash: fundTx,
          }),
        })
        if (!r.ok) {
          const data = await r.json().catch(() => ({}))
          console.warn('[escrow] auto-resume confirm failed', data)
          return
        }
        await refreshSnapshot()
      } catch (e) {
        console.warn(
          '[escrow] auto-resume errored',
          e instanceof Error ? e.message : e,
        )
      }
    })()
  }, [snapshot, id])

  // Auto-fire escrow once wallet is hydrated. Guarded by wallet
  // presence so we never pop a signing request before Privy is ready.
  useEffect(() => {
    if (
      !needsEscrow ||
      !wallet ||
      autoEscrowRef.current === id ||
      escrow.step !== 'idle' ||
      escrow.error
    ) {
      return
    }
    autoEscrowRef.current = id
    runEscrowFunding().catch(() => {})
  }, [needsEscrow, wallet, id, escrow.step, escrow.error, runEscrowFunding])

  return (
    <>
      {/* Top header — always visible */}
      <MainHeader />

      {/* Main shell: thin AppRail · history sidebar · canvas · doc panel */}
      <div className="giga-theme gw-main-shell">
        <AppRail />
        <HistorySidebar />

        {/* CANVAS COLUMN */}
        <main className="gw-canvas-column bg-[#030208]">
          {/* Deep space floating auroras */}
          <div className="gw-aurora" />
          {/* Workflow header */}
          <div className="gw-workflow-header">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex shrink-0 items-center gap-2 rounded border border-[var(--giga-accent)]/30 bg-[var(--giga-accent)]/10 px-2 py-0.5">
                <span className={`h-2 w-2 rounded-full bg-[var(--giga-accent)] ${busy ? 'animate-pulse' : ''}`} />
                <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--giga-accent)]">
                  {viewMode === 'interaction' ? 'Tương tác' : 'Sơ đồ'}
                </span>
              </div>
              <h1 className="font-pixel-body inline truncate text-lg uppercase text-white sm:text-xl lg:text-2xl">
                {title}
              </h1>
            </div>

            {/* View Mode Toggle & Actions */}
            <div className="flex flex-wrap items-center gap-3 font-mono">
              <div className="flex items-center gap-1 rounded bg-white/[0.04] p-0.5 border border-white/5">
                <button
                  type="button"
                  onClick={() => setViewMode('theater')}
                  className={`px-2.5 py-1 text-[9px] uppercase tracking-wider transition ${
                    viewMode === 'theater' ? 'bg-[var(--giga-accent)] text-black font-bold' : 'text-white/60 hover:text-white'
                  }`}
                >
                  🎬 Theater Mode
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('interaction')}
                  className={`px-2.5 py-1 text-[9px] uppercase tracking-wider transition ${
                    viewMode === 'interaction' ? 'bg-[var(--giga-accent)] text-black font-bold' : 'text-white/60 hover:text-white'
                  }`}
                >
                  💻 CLI Terminal
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('canvas')}
                  className={`px-2.5 py-1 text-[9px] uppercase tracking-wider transition ${
                    viewMode === 'canvas' ? 'bg-[var(--giga-accent)] text-black font-bold' : 'text-white/60 hover:text-white'
                  }`}
                >
                  🕸️ DAG Graph
                </button>
              </div>

              {/* TOGGLE DOC PANEL BUTTON */}
              <button
                type="button"
                onClick={() => setShowDocPanel(!showDocPanel)}
                className={`px-2.5 py-1 border rounded text-[9px] uppercase tracking-wider transition flex items-center gap-1.5 ${
                  showDocPanel 
                    ? 'border-purple-500/40 bg-purple-500/10 text-purple-300' 
                    : 'border-white/10 bg-white/5 text-white/50 hover:text-white hover:bg-white/10'
                }`}
              >
                <span>{showDocPanel ? '📖 Hide Docs' : '📘 Show Docs'}</span>
              </button>

              {/* RUN BUTTON */}
              {['planning', 'failed', 'completed'].includes(snapshot?.workflow?.status ?? '') && !busy && (
                <button
                  type="button"
                  onClick={triggerExecution}
                  disabled={executing}
                  className={`pixel-border-sm flex shrink-0 items-center gap-1.5 px-3 py-1.5 font-pixel-body text-xs uppercase transition shadow-md ${
                    snapshot?.workflow?.status === 'planning'
                      ? 'bg-[#ffe082] hover:bg-yellow-300 text-black shadow-[0_0_20px_rgba(255,204,77,0.45)] border border-yellow-400/40 animate-pulse'
                      : 'bg-[#ffe082] hover:bg-yellow-300 text-black'
                  }`}
                >
                  <span>▶</span>
                  <span>{executing ? 'Starting...' : snapshot?.workflow?.status === 'planning' ? 'Run Workflow' : 'Re-run Workflow'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsDeployOpen(true)}
                className="pixel-border-sm flex shrink-0 items-center gap-2 bg-[var(--giga-accent)] px-3 py-1.5 font-pixel-body text-xs text-black transition hover:bg-yellow-300"
              >
                <span className="text-xs">📉</span>
                <span className="hidden sm:inline">DEPLOY</span>
              </button>
            </div>
          </div>

          {/* Main workspace */}
          <div className="gw-grid-bg gw-main-workspace bg-transparent">
            {viewMode === 'theater' && (
              <WorkflowInteraction
                messages={messages}
                status={displayStatus}
                onNodeClick={(planId, label, skill, nodeStatus) => {
                  const det = details.get(planId)
                  setSelectedNode({
                    id: planId,
                    label: label,
                    skill: skill,
                    status: nodeStatus as NodeDetail['status'],
                    input: det?.input,
                    output: det?.output,
                    startedAt: det?.startedAt ?? null,
                    finishedAt: det?.finishedAt ?? null,
                  })
                }}
              />
            )}

            {viewMode === 'interaction' && (
              <WorkflowInteraction
                messages={messages}
                status={displayStatus}
                onNodeClick={(planId, label, skill, nodeStatus) => {
                  const det = details.get(planId)
                  setSelectedNode({
                    id: planId,
                    label: label,
                    skill: skill,
                    status: nodeStatus as NodeDetail['status'],
                    input: det?.input,
                    output: det?.output,
                    startedAt: det?.startedAt ?? null,
                    finishedAt: det?.finishedAt ?? null,
                  })
                }}
              />
            )}

            {viewMode === 'canvas' && (
              <WorkflowCanvas
                messages={messages}
                status={displayStatus}
                workflowId={id}
                erc8183={snapshot?.workflow?.erc8183 ?? null}
                onNodeUpdated={refreshMessages}
              />
            )}
            {busy && (
              <div className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-2 border-2 border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 px-3 py-1.5 text-xs font-pixel-body">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--giga-accent)]" />
                <span className="text-[var(--giga-accent)]">Hermes is orchestrating…</span>
              </div>
            )}
            {/* Escrow progress strip — inline status while auto-fire is signing */}
            {needsEscrow && escrow.step !== 'idle' && escrow.step !== 'error' && escrow.step !== 'done' && (
              <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 border border-[var(--giga-accent)]/30 bg-[#12101f]/95 px-4 py-2.5 text-xs text-white/80 shadow-[0_8px_20px_rgba(0,0,0,0.3)]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--giga-accent)]" />
                <span className="text-[var(--giga-accent)]">
                  {escrow.step === 'preparing' && 'Preparing payment…'}
                  {escrow.step === 'signing-fund' && 'Sign native USDC transfer in wallet…'}
                  {escrow.step === 'confirming' && 'Confirming native payment & backend escrow…'}
                </span>
              </div>
            )}
            {/* Compact retry strip — shown after escrow error */}
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
                <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 inline-flex max-w-[90%] -translate-x-1/2 items-center gap-2.5 border border-cyan-400/40 bg-[#0d091a]/95 px-4 py-2.5 text-xs text-white/95 shadow-[0_8px_25px_rgba(0,0,0,0.55)] rounded-xl backdrop-blur-md">
                  <span className="text-cyan-300 font-bold tracking-wider">Nghiệm Thu Kết Quả (ERC-8004)</span>
                  <span className="text-white/20">·</span>
                  <span className="text-white/70">
                    {validate.step === 'preparing' && 'Đang khởi tạo chứng chỉ…'}
                    {validate.step === 'signing' && 'Ký chứng thực trong ví…'}
                    {validate.step === 'responding' && 'Đang xác thực on-chain…'}
                    {validate.step === 'error' && `Lỗi: ${validate.error ?? 'Thao tác thất bại'}`}
                    {validate.step === 'idle' &&
                      'Ký nhận báo cáo & cộng điểm Uy tín cho AI Agent đã hỗ trợ.'}
                  </span>
                  <button
                    type="button"
                    disabled={
                      validate.step === 'preparing' ||
                      validate.step === 'signing' ||
                      validate.step === 'responding'
                    }
                    onClick={() => validate.attest(id).catch(() => {})}
                    className="ml-1 inline-flex items-center rounded bg-cyan-400 px-3 py-1.5 font-pixel-body text-[10px] uppercase text-black font-bold transition hover:bg-cyan-300 active:scale-95 shadow-[0_0_10px_rgba(34,211,238,0.25)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {validate.step === 'idle' && 'Ký nghiệm thu'}
                    {validate.step !== 'idle' &&
                      validate.step !== 'error' &&
                      `${validate.items.filter((i) => i.status === 'done').length}/${validate.items.length}`}
                    {validate.step === 'error' && 'Thử lại'}
                  </button>
                </div>
              )}
          </div>

          {/* Bottom prompt bar */}
          <BottomPromptBar 
            busy={busy} 
            status={displayStatus ?? ''} 
            onSend={(text) => sendMessage({ text })} 
            onActivate={triggerExecution} 
          />
        </main>

        {/* RIGHT DOC PANEL */}
        {showDocPanel && (
          <WorkflowDocPanel
            title={title}
            prompt={snapshot?.workflow?.prompt}
            messages={messages}
            status={displayStatus}
            erc8183={snapshot?.workflow?.erc8183 ?? null}
          />
        )}
      </div>
      <DeployModal
        isOpen={isDeployOpen}
        onClose={() => setIsDeployOpen(false)}
        workflowId={id}
        workflowTitle={title}
      />
      <NodeDetailSheet
        detail={selectedNode}
        onClose={() => setSelectedNode(null)}
        workflowId={id}
        onNodeUpdated={refreshMessages}
      />
    </>
  )
}

function BottomPromptBar({ 
  busy, 
  status, 
  onSend, 
  onActivate 
}: { 
  busy: boolean; 
  status: string; 
  onSend: (text: string) => void;
  onActivate?: () => void;
}) {
  const [v, setV] = useState('')
  const send = () => {
    const t = v.trim()
    if (!t || busy) return
    onSend(t)
    setV('')
  }

  const isPlanning = status === 'planning'
  const isRunning = status === 'running' || status === 'settling' || status === 'queued'

  if (isPlanning) {
    return (
      <div className="bg-[#030208] p-4 border-t border-white/5 flex flex-col sm:flex-row gap-3 items-center justify-between z-10 shrink-0">
        <div className="flex flex-col font-mono text-xs text-white/50">
          <span className="text-yellow-400 font-bold uppercase tracking-widest text-[9px]">🤖 SYSTEM STANDBY</span>
          <span>Hermes planned successfully. Ready for autonomous activation.</span>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          {/* Quick Refine Input */}
          <input
            type="text"
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Or refine prompt here..."
            className="bg-white/5 border border-white/10 px-3 py-1.5 text-xs font-mono text-white outline-none rounded focus:border-purple-500 flex-1 sm:w-48"
          />
          <button
            onClick={send}
            disabled={!v.trim()}
            className="bg-white/10 hover:bg-white/20 border border-white/15 px-3 py-1.5 font-pixel-body text-[10px] text-white transition rounded disabled:opacity-40"
          >
            Refine
          </button>
          {/* HUGE GLOWING ACTIVATION BUTTON */}
          <button
            onClick={onActivate}
            className="pixel-border-sm flex items-center gap-1.5 bg-gradient-to-r from-yellow-400 to-[#ffe082] text-black px-5 py-2 font-pixel-body text-xs uppercase font-extrabold transition shadow-[0_0_20px_rgba(255,204,77,0.45)] border border-yellow-300 animate-pulse hover:scale-[1.03]"
          >
            🚀 Activate Workflow
          </button>
        </div>
      </div>
    )
  }

  if (isRunning) {
    return (
      <div className="bg-[#030208] p-4 border-t border-white/5 flex items-center justify-between font-mono text-xs z-10 shrink-0">
        <div className="flex items-center gap-2 text-cyan-400 animate-pulse">
          <span className="h-2 w-2 rounded-full bg-cyan-400" />
          <span className="font-bold tracking-widest text-[9px] uppercase">
            {status === 'queued' ? '⏳ WORKFLOW QUEUED IN BACKGROUND' : '⚡ AUTONOMOUS AGENTS OPERATING'}
          </span>
        </div>
        <span className="text-white/40 text-[9px]">Prompt input disabled during execution logs sweep.</span>
      </div>
    )
  }

  return (
    <div className="bg-[var(--giga-dark)] p-4 sm:p-6 z-10 shrink-0">
      <div className="flex items-end gap-2 border border-[#3e3b5e] bg-[var(--giga-panel)] p-3 transition-colors gw-prompt-glow-focus rounded-xl">
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
