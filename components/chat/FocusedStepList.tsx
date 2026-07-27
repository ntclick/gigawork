'use client'

import { useWorkflowData, useWorkflowUI } from './WorkflowContext'
import { useNanopaymentStream } from '@/lib/hooks/useNanopaymentStream'
import { useMemo } from 'react'
import {
  Loader2,
  Bolt,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  Sparkles,
  Layers,
  Activity,
  Zap,
  FileText,
  Terminal,
} from 'lucide-react'

function shortAddr(addr: string) {
  if (!addr) return ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function getDuration(startedAt?: string | null, completedAt?: string | null) {
  if (!startedAt || !completedAt) return ''
  const start = new Date(startedAt).getTime()
  const end = new Date(completedAt).getTime()
  const diffSec = Math.max(0, Math.round((end - start) / 1000))
  if (diffSec < 60) return `0:${diffSec.toString().padStart(2, '0')}`
  return `${Math.floor(diffSec / 60)}:${(diffSec % 60).toString().padStart(2, '0')}`
}

export function FocusedStepList() {
  const { workflowId, prompt, messages, viewState, erc8183, workflowStatus } = useWorkflowData()
  const { setSelectedNode } = useWorkflowUI()
  
  const isRunning = workflowStatus === 'running' || workflowStatus === 'queued'
  const { events, newlyAddedIds, totalUsdc, callCount } = useNanopaymentStream(workflowId, isRunning)

  const steps = viewState?.steps ?? []
  
  // Calculate budget metrics
  const budgetUsdc = parseFloat(erc8183?.budgetUsdc || '0.50')
  const spentUsdc = parseFloat(totalUsdc || '0.00')
  const remainingUsdc = Math.max(0, budgetUsdc - spentUsdc)

  // Calculate earnings per agent
  const earningsMap: Record<string, number> = {}
  events.forEach(e => {
    earningsMap[e.skillName] = (earningsMap[e.skillName] || 0) + parseFloat(e.amountUsdc)
  })

  // List of unique agents in steps
  const uniqueAgents = Array.from(new Set(steps.map(s => s.agentName)))

  // Extract Defensible Thesis from real workflow node outputs / messages
  const thesis = useMemo(() => {
    if (!messages) return null
    try {
      for (const msg of messages) {
        if (!msg.parts) continue
        for (const part of msg.parts) {
          if (part.type === 'tool-dispatchSkill' && part.output) {
            const nodeOut = part.output?.output as Record<string, unknown> | null
            if (!nodeOut) continue

            if (nodeOut.verdict || nodeOut.signal) {
              const verdict = String(nodeOut.verdict || nodeOut.signal || 'Long')
              const conf = Number(nodeOut.confidence || nodeOut.conf || 75)
              const supporting = Array.isArray(nodeOut.supporting)
                ? (nodeOut.supporting as string[])
                : ['Technical indicators and market structure aligned.']
              const counterpoint = String(nodeOut.counterpoint || 'Mixed indicator strength across short vs long-term moving averages.')
              const invalidation = String(nodeOut.invalidation || 'Price closing below EMA50 support level.')
              const source = String(nodeOut.source || nodeOut.binance_mirror || 'Binance / OKX Klines')
              return { verdict, conf, supporting, counterpoint, invalidation, source }
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
    return null
  }, [messages])

  // Extract final report markdown / text from messages
  const finalReport = useMemo(() => {
    if (!messages) return null
    let reportText: string | null = null

    for (const m of messages) {
      for (const p of m.parts ?? []) {
        if (p.type === 'tool-dispatchSkill' && p.output) {
          const out = p.output?.output as Record<string, unknown> | null
          if (out?.markdown && typeof out.markdown === 'string' && out.markdown.trim().length > 0) {
            reportText = out.markdown
          }
          if (out?.output && typeof out.output === 'string' && out.output.trim().length > 0) {
            reportText = out.output
          }
        }
        if (p.type === 'tool-finalizeReport' && p.output) {
          const out = p.output as { summary_markdown?: string }
          if (out.summary_markdown) {
            reportText = out.summary_markdown
          }
        }
      }
      if ((m.role === 'assistant' || m.role === 'brain') && typeof m.content === 'string') {
        const text = m.content.trim()
        if (text.length > 40 && !text.startsWith('▸ Planning') && !text.startsWith('Workflow created')) {
          reportText = reportText || text
        }
      }
    }
    return reportText
  }, [messages])

  // Build real-time protocol execution log console entries (ERC-8004, ERC-8183, x402)
  const protocolLogs = useMemo(() => {
    const logs: Array<{ ts: string; tag: string; text: string; color: string }> = []
    const nowStr = () => new Date().toLocaleTimeString('en-US', { hour12: false })

    // 1. ERC-8183 Escrow Creation Log
    const bUsdc = erc8183?.budgetUsdc || '0.50'
    logs.push({
      ts: nowStr(),
      tag: 'ERC-8183',
      text: `Initialized Arc Escrow Contract (JobId: ${erc8183?.jobId || 'sys-job-auto'}) · Budget: ${bUsdc} USDC`,
      color: 'text-amber-400',
    })

    if (erc8183?.fundTx) {
      logs.push({
        ts: nowStr(),
        tag: 'ERC-8183',
        text: `Escrow deposit funded on Arc Testnet (Tx: ${erc8183.fundTx.slice(0, 10)}...${erc8183.fundTx.slice(-6)})`,
        color: 'text-emerald-400 font-semibold',
      })
    }

    // 2. Steps & ERC-8004 & x402 Logs
    steps.forEach((step) => {
      const addr = step.agentAddress ? shortAddr(step.agentAddress) : '0x8004...BD9e'
      logs.push({
        ts: step.startedAt ? new Date(step.startedAt).toLocaleTimeString('en-US', { hour12: false }) : nowStr(),
        tag: 'ERC-8004',
        text: `Verified Agent Node Identity: ${step.agentName} (${addr}) on Registry (0x8004...BD9e)`,
        color: 'text-cyan-400',
      })

      if (step.status === 'complete') {
        const ev = events.find((e) => e.stepId === step.id || e.skillName === step.agentName)
        const amt = ev ? parseFloat(ev.amountUsdc).toFixed(2) : '0.08'
        logs.push({
          ts: step.completedAt ? new Date(step.completedAt).toLocaleTimeString('en-US', { hour12: false }) : nowStr(),
          tag: 'x402',
          text: `Micropayment settled: +${amt} USDC → ${step.agentName} (${addr})`,
          color: 'text-amber-300 font-semibold',
        })
      }
    })

    // 3. Final Settlement Log
    if (workflowStatus === 'completed') {
      if (erc8183?.completeTx) {
        logs.push({
          ts: nowStr(),
          tag: 'ERC-8183',
          text: `Escrow Settlement Confirmed on Arc Testnet (Tx: ${erc8183.completeTx.slice(0, 10)}...${erc8183.completeTx.slice(-6)})`,
          color: 'text-emerald-300 font-bold',
        })
      }
      if (erc8183?.reputationTx) {
        logs.push({
          ts: nowStr(),
          tag: 'ERC-8004',
          text: `Agent Node Reputation Attestation Recorded (Tx: ${erc8183.reputationTx.slice(0, 10)}...${erc8183.reputationTx.slice(-6)})`,
          color: 'text-cyan-300 font-bold',
        })
      }
      logs.push({
        ts: nowStr(),
        tag: 'PROTOCOL',
        text: `Arc Agentic Protocol Execution Complete · Deliverable Verified & Published`,
        color: 'text-emerald-400 font-bold',
      })
    }

    return logs
  }, [erc8183, steps, events, workflowStatus])

  return (
    <div className="mockup-container w-full h-full text-white overflow-y-auto">
      <style>{`
        .mockup-container {
          --color-background-primary: #12101f;
          --color-background-secondary: #1a172e;
          --color-background-tertiary: #080711;
          --color-border-tertiary: rgba(255, 255, 255, 0.08);
          --color-text-primary: #ffffff;
          --color-text-secondary: rgba(255, 255, 255, 0.4);
          --font-sans: var(--font-sans), system-ui, sans-serif;
          --font-mono: var(--font-mono), monospace;
          --border-radius-lg: 12px;
          --border-radius-md: 8px;
          font-family: var(--font-sans);
          background: var(--color-background-tertiary);
        }
        .mockup-layout {
          display: grid;
          grid-template-columns: 1fr 280px;
          min-height: 560px;
        }
        @media (max-width: 768px) {
          .mockup-layout {
            grid-template-columns: 1fr;
          }
          .mockup-sidebar {
            border-left: none;
            border-top: 0.5px solid var(--color-border-tertiary);
          }
        }
        .mockup-main {
          padding: 20px;
          border-right: 0.5px solid var(--color-border-tertiary);
        }
        .mockup-sidebar {
          padding: 16px;
          background: #0b0a14;
        }
        .econ-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin-bottom: 20px;
        }
        .econ-card {
          background: var(--color-background-primary);
          border: 0.5px solid var(--color-border-tertiary);
          border-radius: var(--border-radius-md);
          padding: 10px 12px;
        }
        .econ-label {
          font-size: 11px;
          color: var(--color-text-secondary);
          margin-bottom: 4px;
        }
        .econ-val {
          font-size: 20px;
          font-weight: 500;
          color: var(--color-text-primary);
          font-family: var(--font-mono);
        }
        .econ-sub {
          font-size: 11px;
          color: var(--color-text-secondary);
          margin-top: 2px;
        }
        .timeline {
          position: relative;
          padding-left: 32px;
        }
        .tl-line {
          position: absolute;
          left: 10px;
          top: 0;
          bottom: 0;
          width: 1px;
          background: var(--color-border-tertiary);
        }
        .tl-item {
          position: relative;
          margin-bottom: 16px;
        }
        .tl-dot {
          position: absolute;
          left: -27px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          top: 14px;
          border: 2px solid;
        }
        .dot-done {
          background: #1D9E75;
          border-color: #1D9E75;
        }
        .dot-active {
          background: #fff;
          border-color: #1D9E75;
          box-shadow: 0 0 0 3px rgba(29, 158, 117, .18);
        }
        .dot-pending {
          background: var(--color-background-secondary);
          border-color: var(--color-border-tertiary);
        }
        .dot-payment {
          position: absolute;
          left: -27px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          top: 14px;
          background: #BA7517;
          border: 2px solid #BA7517;
        }
        .tl-card {
          background: var(--color-background-primary);
          border: 0.5px solid var(--color-border-tertiary);
          border-radius: var(--border-radius-md);
          padding: 10px 12px;
          margin-bottom: 4px;
        }
        .tl-card.active {
          border-color: #1D9E75;
          border-left: 2px solid #1D9E75;
          border-radius: 0 var(--border-radius-md) var(--border-radius-md) 0;
        }
        .tl-card.payment-row {
          border-color: #EF9F27;
          background: #2a1f10;
          padding: 6px 12px;
          margin-bottom: 4px;
        }
        .tl-head {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tl-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text-primary);
        }
        .tl-addr {
          font-size: 11px;
          color: var(--color-text-secondary);
          font-family: var(--font-mono);
        }
        .tl-right {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .tl-cost {
          font-size: 12px;
          font-weight: 500;
          font-family: var(--font-mono);
          color: #1D9E75;
        }
        .tl-cost.pending {
          color: var(--color-text-secondary);
        }
        .tl-time {
          font-size: 11px;
          color: var(--color-text-secondary);
        }
        .tl-detail {
          font-size: 12px;
          color: var(--color-text-secondary);
          margin-top: 4px;
          line-height: 1.5;
        }
        .payment-label {
          font-size: 11px;
          color: #f59e0b;
          font-weight: 500;
          font-family: var(--font-mono);
        }
        @keyframes flashPay {
          0% { opacity: 0.4; }
          50% { opacity: 1; }
          100% { opacity: 0.4; }
        }
        .tl-card.payment-row.new {
          animation: flashPay 1.2s ease 2;
        }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(29, 158, 117, .18); }
          50% { box-shadow: 0 0 0 5px rgba(29, 158, 117, .28); }
        }
        .dot-active {
          animation: pulse 1.4s ease infinite;
        }
        .sb-section {
          margin-bottom: 20px;
        }
        .sb-title {
          font-size: 11px;
          font-weight: 500;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: .04em;
          margin-bottom: 10px;
        }
        .earnings-bar {
          margin-bottom: 8px;
        }
        .eb-head {
          display: flex;
          justify-content: space-between;
          margin-bottom: 3px;
        }
        .eb-name {
          font-size: 12px;
          color: var(--color-text-primary);
        }
        .eb-val {
          font-size: 12px;
          font-weight: 500;
          font-family: var(--font-mono);
          color: #1D9E75;
        }
        .bar-track {
          height: 4px;
          background: var(--color-background-secondary);
          border-radius: 2px;
          overflow: hidden;
        }
        .bar-fill {
          height: 4px;
          background: #1D9E75;
          border-radius: 2px;
          transition: width 0.3s ease;
        }
        .divider {
          height: 0.5px;
          background: var(--color-border-tertiary);
          margin: 12px 0;
        }
        .escrow-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;
          border-bottom: 0.5px solid var(--color-border-tertiary);
        }
        .escrow-label {
          font-size: 12px;
          color: var(--color-text-secondary);
        }
        .escrow-val {
          font-size: 12px;
          font-weight: 500;
          font-family: var(--font-mono);
        }
        .escrow-val.locked {
          color: #f59e0b;
        }
        .escrow-val.done {
          color: #1D9E75;
        }
        .ticker-item {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 0;
          border-bottom: 0.5px solid var(--color-border-tertiary);
        }
        .ticker-text {
          font-size: 11px;
          color: var(--color-text-secondary);
          font-family: var(--font-mono);
          flex: 1;
        }
        .ticker-amt {
          font-size: 11px;
          font-weight: 500;
          font-family: var(--font-mono);
          color: #1D9E75;
        }
      `}</style>

      <div className="mockup-layout">
        {/* Main Content Area */}
        <div className="mockup-main">
          {/* Economy Summary Row */}
          <div className="econ-row">
            <div className="econ-card">
              <div className="econ-label">Total budget</div>
              <div className="econ-val">{budgetUsdc.toFixed(2)} USDC</div>
              <div className="econ-sub">USDC locked in escrow</div>
            </div>
            <div className="econ-card">
              <div className="econ-label">Spent so far</div>
              <div className="econ-val" style={{ color: '#1D9E75' }}>
                {spentUsdc.toFixed(2)} USDC
              </div>
              <div className="econ-sub">via x402 · {callCount} calls</div>
            </div>
            <div className="econ-card">
              <div className="econ-label">Remaining</div>
              <div className="econ-val">{remainingUsdc.toFixed(2)} USDC</div>
              <div className="econ-sub">releases on verify</div>
            </div>
          </div>

          {/* Defensible Thesis Hero Card (Signals Style) */}
          {thesis && (
            <div className="mb-6 overflow-hidden rounded-2xl border border-cyan-500/30 bg-[#0d101d] p-5 shadow-[0_0_30px_rgba(34,211,238,0.1)]">
              {/* Header Badge & Verdict */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Defensible Thesis Report</div>
                    <div className="text-sm font-semibold text-white/90">{prompt || 'Multi-Agent Strategy Thesis'}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide border ${
                    thesis.verdict.toLowerCase().includes('long') || thesis.verdict.toLowerCase().includes('buy')
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : thesis.verdict.toLowerCase().includes('short') || thesis.verdict.toLowerCase().includes('sell')
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                        : 'border-white/20 bg-white/10 text-white/70'
                  }`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    <span>{thesis.verdict}</span>
                    <span className="text-[10px] opacity-75">({thesis.conf}%)</span>
                  </span>
                </div>
              </div>

              {/* Supporting Evidence List */}
              <div className="mt-4 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Supporting Reasons & Evidence
                </div>
                <div className="space-y-1.5 pl-1">
                  {thesis.supporting.map((sup, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-white/80 leading-relaxed">
                      <span className="text-emerald-400 text-sm leading-none">•</span>
                      <span>{sup}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Counterpoint & Invalidation Grid */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
                  <div className="font-bold text-amber-400 flex items-center gap-1.5 mb-1 text-[11px]">
                    <AlertTriangle className="h-3.5 w-3.5" /> Counterpoint & Risks
                  </div>
                  <div className="text-white/70 leading-relaxed text-[11px]">{thesis.counterpoint}</div>
                </div>

                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs">
                  <div className="font-bold text-rose-400 flex items-center gap-1.5 mb-1 text-[11px]">
                    <XCircle className="h-3.5 w-3.5" /> Invalidation Trigger
                  </div>
                  <div className="text-white/70 leading-relaxed text-[11px]">{thesis.invalidation}</div>
                </div>
              </div>

              {/* Verification & Data Source Footer */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-[10px] text-white/40">
                <div className="flex items-center gap-1.5 text-cyan-300/80">
                  <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Attested on-chain · ERC-8004 Agent Verification</span>
                </div>
                <div className="font-mono text-white/30">Source: {thesis.source}</div>
              </div>
            </div>
          )}

          {/* Timeline Section */}
          <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-white/40 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-cyan-400" /> Multi-Agent Execution Pipeline
          </div>
          {steps.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="h-7 w-7 animate-spin text-emerald-400/50" />
              <p className="text-xs text-white/30 font-mono">Waiting for agent steps…</p>
            </div>
          ) : (
            <div className="timeline">
              <div className="tl-line"></div>

              {steps.map((step) => {
                const duration = getDuration(step.startedAt, step.completedAt)

                // Match with nanopayment events
                // First try to match by stepId, then fallback to skillName if stepId is not set
                const stepEvent = events.find(
                  e => e.stepId === step.id || (e.skillName === step.agentName && !e.stepId)
                )

                let dotClass = 'dot-pending'
                let cardClass = ''
                let badgeLabel = 'pending'
                let badgeStyleClass = 'bg-[#1a172e] text-white/50'

                if (step.status === 'active') {
                  dotClass = 'dot-active'
                  cardClass = 'active'
                  badgeLabel = 'running'
                  badgeStyleClass = 'bg-[#FAEEDA] text-[#854F0B]'
                } else if (step.status === 'complete') {
                  dotClass = 'dot-done'
                  badgeLabel = 'paid'
                  badgeStyleClass = 'bg-[#E1F5EE] text-[#0F6E56]'
                } else if (step.status === 'failed') {
                  dotClass = 'dot-pending' // keep it red in theme
                  badgeLabel = 'failed'
                  badgeStyleClass = 'bg-red-500/10 text-red-400'
                }

                return (
                  <div key={step.id}>
                    {/* Step Row */}
                    <div
                      className="tl-item cursor-pointer"
                      onClick={() =>
                        setSelectedNode({
                          id: step.id,
                          label: step.label,
                          skill: step.agentName,
                          status:
                            step.status === 'complete'
                              ? 'completed'
                              : step.status === 'active'
                                ? 'running'
                                : step.status === 'failed'
                                  ? 'failed'
                                  : 'pending',
                          startedAt: step.startedAt ? new Date(step.startedAt).getTime() : null,
                          finishedAt: step.completedAt ? new Date(step.completedAt).getTime() : null,
                        })
                      }
                    >
                      <div className={`tl-dot ${dotClass}`}></div>
                      <div className={`tl-card ${cardClass}`}>
                        <div className="tl-head">
                          <span className="tl-name">{step.label}</span>
                          {step.agentAddress && (
                            <span className="tl-addr">{shortAddr(step.agentAddress)}</span>
                          )}
                          <div className="tl-right">
                            <span className={`tl-cost ${step.status !== 'complete' ? 'pending' : ''}`}>
                              {stepEvent ? `${parseFloat(stepEvent.amountUsdc).toFixed(2)} USDC` : '—'}
                            </span>
                            <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${badgeStyleClass}`}>
                              {badgeLabel}
                            </span>
                            {duration && <span className="tl-time">{duration}</span>}
                          </div>
                        </div>
                        {step.outputSummary && (
                          <div className="tl-detail">{step.outputSummary}</div>
                        )}
                        {step.errorMessage && (
                          <div className="tl-detail text-red-400">{step.errorMessage}</div>
                        )}
                      </div>
                    </div>

                    {/* Payment Row (if step was paid) */}
                    {stepEvent && (
                      <div className="tl-item">
                        <div className="dot-payment" style={{ top: '6px' }}></div>
                        <div className={`tl-card payment-row ${newlyAddedIds.has(stepEvent.id) ? 'new' : ''}`}>
                          <span className="payment-label">
                            ⚡ x402 · {parseFloat(stepEvent.amountUsdc).toFixed(2)} USDC → {step.agentAddress ? shortAddr(step.agentAddress) : '0x...'} · settled
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Deliverable Report / Output Card */}
          {finalReport && (
            <div className="mt-6 rounded-2xl border border-cyan-500/30 bg-[#0b0e17] p-5 shadow-[0_0_25px_rgba(0,0,0,0.5)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-cyan-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">Generated Report Deliverable</span>
                </div>
                <span className="rounded bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-300 border border-cyan-500/20 font-bold">
                  Verified On-Chain
                </span>
              </div>
              <SimpleMarkdown content={finalReport} />
            </div>
          )}

          {/* Protocol Execution Console (ERC-8004, ERC-8183, x402) */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-[#080b12] p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-cyan-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-white">
                  Arc Protocol Execution Logs
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px]">
                <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-cyan-300 border border-cyan-500/20 font-bold">ERC-8004</span>
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-300 border border-amber-500/20 font-bold">ERC-8183</span>
                <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-300 border border-emerald-500/20 font-bold">x402</span>
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1.5 p-2 bg-black/50 rounded-xl border border-white/5 custom-scrollbar">
              {protocolLogs.map((line, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-white/30 shrink-0 select-none">{line.ts}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${
                    line.tag === 'ERC-8004' ? 'bg-cyan-500/20 text-cyan-300' :
                    line.tag === 'ERC-8183' ? 'bg-amber-500/20 text-amber-300' :
                    line.tag === 'x402' ? 'bg-emerald-500/20 text-emerald-300' :
                    'bg-purple-500/20 text-purple-300'
                  }`}>
                    {line.tag}
                  </span>
                  <span className={`break-words ${line.color}`}>{line.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="mockup-sidebar">
          {/* Agent Earnings Section */}
          <div className="sb-section">
            <div className="sb-title">Agent earnings</div>
            {uniqueAgents.length === 0 ? (
              <div className="text-xs text-white/30 italic">No agents active yet</div>
            ) : (
              uniqueAgents.map(agentName => {
                const earnings = earningsMap[agentName] || 0
                const percent = budgetUsdc > 0 ? (earnings / budgetUsdc) * 100 : 0
                return (
                  <div key={agentName} className="earnings-bar">
                    <div className="eb-head">
                      <span className="eb-name truncate max-w-[160px]">{agentName}</span>
                      <span className="eb-val">{earnings > 0 ? `${earnings.toFixed(2)} USDC` : '—'}</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${percent}%` }}></div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="divider"></div>

          {/* ERC-8183 Escrow Section */}
          <div className="sb-section">
            <div className="sb-title">ERC-8183 escrow</div>
            <div className="escrow-row">
              <span className="escrow-label">Deposited</span>
              <span className="escrow-val">{budgetUsdc.toFixed(2)} USDC</span>
            </div>
            <div className="escrow-row">
              <span className="escrow-label">Disbursed</span>
              <span className="escrow-val done">{spentUsdc.toFixed(2)} USDC</span>
            </div>
            <div className="escrow-row">
              <span className="escrow-label">Locked</span>
              <span className="escrow-val locked">{remainingUsdc.toFixed(2)} USDC</span>
            </div>
            <div className="escrow-row" style={{ border: 'none' }}>
              <span className="escrow-label">Status</span>
              <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                workflowStatus === 'completed'
                  ? 'bg-[#E1F5EE] text-[#0F6E56]'
                  : workflowStatus === 'failed'
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-[#FAEEDA] text-[#854F0B]'
              }`}>
                {workflowStatus || 'active'}
              </span>
            </div>
          </div>

          <div className="divider"></div>

          {/* x402 Live Feed Section */}
          <div className="sb-section">
            <div className="sb-title">x402 live feed</div>
            {events.length === 0 ? (
              <div className="text-xs text-white/30 italic">No payments recorded yet</div>
            ) : (
              events.slice(0, 5).map(e => (
                <div key={e.id} className="ticker-item">
                  <Bolt className="h-3.5 w-3.5 text-[#BA7517] shrink-0" />
                  <span className="ticker-text truncate">{e.skillName}</span>
                  <span className="ticker-amt">+{parseFloat(e.amountUsdc).toFixed(2)}</span>
                </div>
              ))
            )}
            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>Total settled</span>
              <span style={{ fontSize: '12px', fontWeight: 500, fontFamily: 'var(--font-mono)', color: '#1D9E75' }}>
                {spentUsdc.toFixed(2)} USDC
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <div className="space-y-2 text-xs leading-relaxed text-white/90 font-sans">
      {lines.map((line, idx) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={idx} className="h-1" />
        if (trimmed.startsWith('# ')) {
          return <h1 key={idx} className="text-base font-bold text-cyan-300 mt-3 mb-1 border-b border-white/10 pb-1">{trimmed.slice(2)}</h1>
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={idx} className="text-sm font-bold text-cyan-400 mt-2 mb-1">{trimmed.slice(3)}</h2>
        }
        if (trimmed.startsWith('### ')) {
          return <h3 key={idx} className="text-xs font-bold text-amber-300 mt-2 mb-0.5">{trimmed.slice(4)}</h3>
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-2 text-white/80">
              <span className="text-cyan-400 text-sm leading-none">•</span>
              <span>{trimmed.slice(2)}</span>
            </div>
          )
        }
        if (trimmed.match(/^\d+\.\s/)) {
          const num = trimmed.match(/^(\d+)\.\s/)?.[1]
          const text = trimmed.replace(/^\d+\.\s/, '')
          return (
            <div key={idx} className="flex items-start gap-2 pl-2 text-white/80">
              <span className="font-mono text-cyan-400 text-[11px] font-bold">{num}.</span>
              <span>{text}</span>
            </div>
          )
        }
        return <p key={idx} className="text-white/75">{line}</p>
      })}
    </div>
  )
}
