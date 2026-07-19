'use client'

import { useWorkflowData, useWorkflowUI } from './WorkflowContext'
import { useNanopaymentStream } from '@/lib/hooks/useNanopaymentStream'
import {
  Loader2,
  Bolt,
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
  const { workflowId, viewState, erc8183, workflowStatus } = useWorkflowData()
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

          {/* Timeline */}
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
