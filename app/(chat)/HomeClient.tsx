'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePrivy } from '@privy-io/react-auth'
import {
  ArrowRight,
  Bot,
  FileText,
  Loader2,
  Network,
  Radio,
  ShieldCheck,
  Sparkles,
  WalletCards,
  Zap,
} from 'lucide-react'

import { MainHeader } from '@/components/shell/MainHeader'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { AppRail } from '@/components/shell/AppRail'
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@/lib/workflowTemplates'
import { toast } from '@/components/ui/toast'

function getSkillActionName(name: string): string {
  switch (name) {
    case 'crypto-scanner': return 'Scan'
    case 'social-sentiment': return 'Sentiment'
    case 'polymarket-pulse': return 'Odds'
    case 'report-composer':
    case 'report-composer-fast':
      return 'Report'
    case 'telegram-sender': return 'Telegram'
    case 'email-sender': return 'Email'
    case 'defi-yields': return 'Yield'
    case 'dca-executor': return 'DCA'
    case 'whale-tracker': return 'Wallet'
    case 'trading-signals': return 'Signals'
    default: return name.replace(/-/g, ' ')
  }
}

const CATEGORY_COPY: Record<WorkflowTemplate['category'], string> = {
  research: 'Research',
  'on-chain': 'On-chain',
  execution: 'Execution',
  analysis: 'Analysis',
}

const EXAMPLE_PROMPTS = [
  'Track BTC + ETH 4h signals and send me a digest',
  'Watch a whale wallet and flag transfers over $100k',
  'Find Polymarket odds shifts with volume context',
]

export function HomeClient() {
  const router = useRouter()
  const { ready, authenticated } = usePrivy()
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Live stats and agents list
  const [tickerStats, setTickerStats] = useState({ onlineAgents: 0, jobsSettled: 0, totalPaidUsdc: 0.0 })
  const [agentsList, setAgentsList] = useState<any[]>([])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`
  }, [prompt])

  // Fetch live ticker stats and agents roster
  useEffect(() => {
    const loadSystemData = async () => {
      try {
        const skillsRes = await fetch('/api/skills', { cache: 'no-store' })
        const skillsData = await skillsRes.json()
        const list = skillsData.skills ?? []
        setAgentsList(list)

        const activeCount = list.filter((a: any) => a.status === 'online' || a.status === 'busy').length

        const statsRes = await fetch('/api/admin/system-stats', { cache: 'no-store' })
        const statsData = await statsRes.json()
        if (statsData.success && statsData.stats) {
          const stats = statsData.stats
          setTickerStats({
            onlineAgents: activeCount,
            jobsSettled: stats.totalNanopaymentCalls ? parseInt(stats.totalNanopaymentCalls) : 0,
            totalPaidUsdc: stats.totalNanopaymentRevenue ? parseFloat(stats.totalNanopaymentRevenue) : 0.0,
          })
        } else {
          setTickerStats((prev) => ({ ...prev, onlineAgents: activeCount }))
        }
      } catch (err) {
        console.error('Failed to fetch system stats ticker data:', err)
      }
    }
    loadSystemData()
  }, [])

  const submit = useCallback(async (text: string) => {
    const t = text.trim()
    if (!t || submitting) return
    if (!authenticated) {
      toast.warning('Connect wallet', 'You need to connect your wallet first.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: t }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        if (j.error === 'identity_required') {
          toast.error('Identity NFT required', 'Mint your ERC-8004 identity NFT to continue.')
        } else {
          toast.error('Failed to create workflow', j.message ?? String(res.status))
        }
        return
      }
      const { id } = await res.json()
      router.push(`/workflow/${id}`)
    } catch (e) {
      toast.error('Network error', e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }, [submitting, authenticated, router])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(prompt)
    }
  }

  const fillPrompt = (text: string) => {
    setPrompt(text)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <>
      <MainHeader />
      <div className="giga-theme gw-main-shell">
        <AppRail />
        <HistorySidebar />

        <main className="orch-container flex flex-1 flex-col overflow-y-auto">
          <style dangerouslySetInnerHTML={{ __html: `
            .orch-container {
              position: relative;
              isolation: isolate;
              background:
                radial-gradient(circle at 22% 0%, rgba(34, 211, 238, 0.11), transparent 28%),
                radial-gradient(circle at 78% 6%, rgba(113, 112, 255, 0.16), transparent 30%),
                linear-gradient(180deg, #07080b 0%, #08090d 48%, #06070a 100%);
              color: #f7f8f8;
              font-feature-settings: "cv01", "ss03";
            }
            .orch-container::before {
              content: '';
              position: absolute;
              inset: 0;
              z-index: -2;
              background-image:
                linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px);
              background-size: 72px 72px;
              mask-image: linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0.08) 68%, transparent);
            }
            .orch-container::after {
              content: '';
              position: absolute;
              inset: 0;
              z-index: -1;
              background: radial-gradient(ellipse at center top, transparent 0%, rgba(0,0,0,0.2) 45%, rgba(0,0,0,0.5) 100%);
              pointer-events: none;
            }
            .orch-shell {
              width: 100%;
              max-width: 1180px;
              margin: 0 auto;
              padding: 56px 32px 72px;
            }
            .orch-hero-grid {
              display: grid;
              grid-template-columns: minmax(0, 1fr) 360px;
              gap: 28px;
              align-items: end;
              margin-bottom: 24px;
            }
            .orch-eyebrow {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              width: fit-content;
              border: 1px solid rgba(255,255,255,0.08);
              background: rgba(255,255,255,0.035);
              color: #8a8f98;
              border-radius: 999px;
              padding: 7px 11px;
              font-size: 11px;
              font-weight: 590;
              letter-spacing: 0.11em;
              text-transform: uppercase;
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
            }
            .orch-eyebrow .live-dot,
            .route-dot {
              width: 7px;
              height: 7px;
              border-radius: 999px;
              background: #10b981;
              box-shadow: 0 0 12px rgba(16, 185, 129, 0.55);
            }
            .orch-copy h1 {
              max-width: 720px;
              margin: 18px 0 12px;
              color: #f7f8f8;
              font-size: clamp(36px, 5.4vw, 64px);
              font-weight: 590;
              letter-spacing: -0.062em;
              line-height: 0.98;
            }
            .orch-copy p {
              max-width: 640px;
              color: #8a8f98;
              font-size: 16px;
              line-height: 1.7;
            }
            .orch-capabilities {
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
              margin-top: 20px;
            }
            .orch-capabilities span {
              display: inline-flex;
              align-items: center;
              gap: 7px;
              border: 1px solid rgba(255,255,255,0.08);
              background: rgba(255,255,255,0.03);
              border-radius: 999px;
              padding: 8px 11px;
              color: #d0d6e0;
              font-size: 12px;
              font-weight: 510;
            }
            .route-panel {
              border: 1px solid rgba(255,255,255,0.085);
              background:
                linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.022)),
                rgba(13, 15, 22, 0.92);
              border-radius: 18px;
              padding: 18px;
              box-shadow: 0 28px 80px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.06);
            }
            .route-topline {
              display: flex;
              align-items: center;
              justify-content: space-between;
              color: #62666d;
              font-size: 11px;
              font-weight: 590;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              margin-bottom: 16px;
            }
            .route-list {
              display: grid;
              gap: 10px;
            }
            .route-item {
              display: grid;
              grid-template-columns: 34px minmax(0,1fr);
              gap: 11px;
              align-items: center;
              border: 1px solid rgba(255,255,255,0.06);
              background: rgba(255,255,255,0.027);
              border-radius: 12px;
              padding: 10px;
            }
            .route-icon {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 34px;
              height: 34px;
              border-radius: 10px;
              color: #828fff;
              background: rgba(113,112,255,0.11);
              border: 1px solid rgba(113,112,255,0.17);
            }
            .route-item strong {
              display: block;
              color: #f7f8f8;
              font-size: 13px;
              font-weight: 590;
              letter-spacing: -0.01em;
            }
            .route-item span {
              display: block;
              color: #62666d;
              font-size: 12px;
              margin-top: 2px;
            }
            .composer-panel {
              overflow: hidden;
              border: 1px solid rgba(255,255,255,0.09);
              background:
                linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.025)),
                rgba(11, 12, 18, 0.94);
              border-radius: 22px;
              box-shadow: 0 32px 110px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.07);
              margin-bottom: 30px;
            }
            .composer-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 16px;
              border-bottom: 1px solid rgba(255,255,255,0.07);
              padding: 15px 18px;
            }
            .composer-title {
              display: inline-flex;
              align-items: center;
              gap: 9px;
              color: #d0d6e0;
              font-size: 13px;
              font-weight: 590;
            }
            .composer-meta {
              color: #62666d;
              font-family: var(--font-geist-mono), ui-monospace, monospace;
              font-size: 11px;
            }
            .composer-input {
              position: relative;
            }
            .composer-input textarea {
              width: 100%;
              min-height: 126px;
              max-height: 260px;
              resize: none;
              border: none;
              outline: none;
              background: transparent;
              color: #f7f8f8;
              padding: 22px 22px 12px;
              font: inherit;
              font-size: 15px;
              line-height: 1.65;
            }
            .composer-input textarea::placeholder {
              color: rgba(208, 214, 224, 0.3);
            }
            .prompt-examples {
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
              padding: 18px;
            }
            .prompt-chip {
              border: 1px solid rgba(255,255,255,0.075);
              background: rgba(255,255,255,0.03);
              color: #8a8f98;
              border-radius: 999px;
              padding: 7px 10px;
              font-size: 12px;
              transition: border-color 160ms, color 160ms, background 160ms;
            }
            .prompt-chip:hover {
              border-color: rgba(113,112,255,0.32);
              background: rgba(113,112,255,0.08);
              color: #d0d6e0;
            }
            .composer-actions {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 14px;
              border-top: 1px solid rgba(255,255,255,0.07);
              background: rgba(255,255,255,0.018);
              padding: 13px 14px 14px 18px;
            }
            .composer-hint {
              color: #62666d;
              font-size: 12px;
            }
            .run-button {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              min-height: 40px;
              border: 1px solid rgba(130,143,255,0.42);
              background: linear-gradient(180deg, #7775ff, #5e6ad2);
              color: #fff;
              border-radius: 10px;
              padding: 0 15px;
              font-size: 13px;
              font-weight: 590;
              box-shadow: 0 12px 34px rgba(94,106,210,0.28), inset 0 1px 0 rgba(255,255,255,0.22);
              transition: transform 160ms, filter 160ms, opacity 160ms;
            }
            .run-button:hover:not(:disabled) {
              transform: translateY(-1px);
              filter: brightness(1.05);
            }
            .run-button:disabled {
              cursor: not-allowed;
              opacity: 0.42;
              transform: none;
              box-shadow: none;
            }
            .templates-section {
              border: 1px solid rgba(255,255,255,0.07);
              background: rgba(255,255,255,0.018);
              border-radius: 22px;
              padding: 18px;
            }
            .templates-head {
              display: flex;
              align-items: end;
              justify-content: space-between;
              gap: 18px;
              padding: 2px 2px 16px;
            }
            .templates-kicker {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              color: #7170ff;
              font-size: 11px;
              font-weight: 590;
              letter-spacing: 0.11em;
              text-transform: uppercase;
            }
            .templates-head h2 {
              margin-top: 6px;
              color: #f7f8f8;
              font-size: 22px;
              font-weight: 590;
              letter-spacing: -0.035em;
            }
            .templates-head p {
              color: #62666d;
              font-size: 13px;
            }
            .templates-count {
              border: 1px solid rgba(255,255,255,0.08);
              background: rgba(255,255,255,0.035);
              color: #8a8f98;
              border-radius: 999px;
              padding: 7px 10px;
              font-family: var(--font-geist-mono), ui-monospace, monospace;
              font-size: 11px;
              white-space: nowrap;
            }
            .workflow-grid {
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              gap: 12px;
            }
            .wf-card {
              position: relative;
              display: flex;
              min-height: 256px;
              flex-direction: column;
              overflow: hidden;
              border: 1px solid rgba(255,255,255,0.08);
              background: linear-gradient(180deg, rgba(255,255,255,0.052), rgba(255,255,255,0.022));
              border-radius: 16px;
              padding: 15px;
              transition: transform 180ms, border-color 180ms, background 180ms;
            }
            .wf-card::before {
              content: '';
              position: absolute;
              inset: 0 0 auto 0;
              height: 2px;
              background: linear-gradient(90deg, rgba(113,112,255,0.08), var(--card-accent, #7170ff), rgba(34,211,238,0.06));
              opacity: 0.8;
            }
            .wf-card:hover {
              transform: translateY(-2px);
              border-color: color-mix(in srgb, var(--card-accent, #7170ff) 38%, rgba(255,255,255,0.08));
              background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03));
            }
            .wf-card-research { --card-accent: #22d3ee; }
            .wf-card-on-chain { --card-accent: #10b981; }
            .wf-card-execution { --card-accent: #f59e0b; }
            .wf-card-analysis { --card-accent: #a78bfa; }
            .wf-top {
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 10px;
              margin-bottom: 14px;
            }
            .wf-badge {
              display: inline-flex;
              align-items: center;
              gap: 7px;
              border: 1px solid color-mix(in srgb, var(--card-accent, #7170ff) 28%, transparent);
              background: color-mix(in srgb, var(--card-accent, #7170ff) 12%, transparent);
              color: color-mix(in srgb, var(--card-accent, #7170ff) 82%, #ffffff);
              border-radius: 999px;
              padding: 5px 8px;
              font-size: 10px;
              font-weight: 590;
              letter-spacing: 0.07em;
              text-transform: uppercase;
            }
            .wf-emoji {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 32px;
              height: 32px;
              border: 1px solid rgba(255,255,255,0.08);
              background: rgba(255,255,255,0.035);
              border-radius: 11px;
              font-size: 17px;
            }
            .wf-title {
              color: #f7f8f8;
              font-size: 15px;
              font-weight: 590;
              letter-spacing: -0.02em;
              line-height: 1.25;
              margin-bottom: 7px;
            }
            .wf-desc {
              color: #8a8f98;
              font-size: 12px;
              line-height: 1.55;
            }
            .wf-agents {
              display: flex;
              flex-wrap: wrap;
              gap: 6px;
              margin: 14px 0 12px;
            }
            .agent-chip {
              display: inline-flex;
              align-items: center;
              gap: 5px;
              max-width: 100%;
              border: 1px solid rgba(255,255,255,0.075);
              background: rgba(0,0,0,0.12);
              color: #d0d6e0;
              border-radius: 7px;
              padding: 4px 7px;
              font-family: var(--font-geist-mono), ui-monospace, monospace;
              font-size: 10px;
              line-height: 1;
            }
            .agent-chip::before {
              content: '';
              width: 5px;
              height: 5px;
              border-radius: 999px;
              background: var(--card-accent, #7170ff);
            }
            .wf-flow {
              display: flex;
              flex-wrap: wrap;
              align-items: center;
              gap: 5px;
              margin-top: auto;
              padding-top: 2px;
              color: #62666d;
              font-size: 11px;
            }
            .wf-flow strong {
              color: #d0d6e0;
              font-weight: 510;
            }
            .wf-arrow {
              color: color-mix(in srgb, var(--card-accent, #7170ff) 55%, #62666d);
            }
            .use-btn {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              width: 100%;
              min-height: 36px;
              margin-top: 14px;
              border: 1px solid rgba(255,255,255,0.09);
              background: rgba(255,255,255,0.025);
              color: #d0d6e0;
              border-radius: 10px;
              font-size: 12px;
              font-weight: 510;
              transition: border-color 160ms, color 160ms, background 160ms;
            }
            .use-btn:hover {
              border-color: color-mix(in srgb, var(--card-accent, #7170ff) 40%, rgba(255,255,255,0.08));
              background: color-mix(in srgb, var(--card-accent, #7170ff) 10%, rgba(255,255,255,0.025));
              color: #f7f8f8;
            }
            @media (max-width: 1280px) {
              .workflow-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            }
            @media (max-width: 1024px) {
              .orch-shell { padding: 42px 22px 56px; }
              .orch-hero-grid { grid-template-columns: 1fr; align-items: start; }
              .route-panel { display: none; }
              .workflow-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            }
            @media (max-width: 640px) {
              .orch-shell { padding: 28px 14px 42px; }
              .orch-copy h1 { font-size: 38px; }
              .composer-header,
              .composer-actions,
              .templates-head { align-items: flex-start; flex-direction: column; }
              .workflow-grid { grid-template-columns: 1fr; }
              .route-panel { display: none; }
            }
          ` }} />

          <div className="orch-shell">
            <section className="orch-hero-grid" aria-label="Workflow launcher intro">
              <div className="orch-copy">
                <div className="orch-eyebrow">
                  <span className="live-dot" />
                  Agent Economy
                </div>
                <h1>Describe a task. Hermes hires the right agents and pays them per call.</h1>
                <p>
                  Describe the outcome. GigaWork routes the task through scanners,
                  wallet monitors, trading analysts, and report senders — then opens
                  a live workflow you can inspect.
                </p>
                <div className="orch-capabilities" aria-label="Capabilities">
                  <span><ShieldCheck className="h-3.5 w-3.5" /> Arc settlement</span>
                  <span><WalletCards className="h-3.5 w-3.5" /> Wallet-aware jobs</span>
                  <span><Radio className="h-3.5 w-3.5" /> Live execution stream</span>
                </div>
              </div>

              <aside className="route-panel" aria-label="Agent routing preview">
                <div className="route-topline">
                  <span>Routing preview</span>
                  <span className="route-dot" />
                </div>
                <div className="route-list">
                  <div className="route-item">
                     <div className="route-icon"><Bot className="h-4 w-4" /></div>
                    <div><strong>Planner selects agents</strong><span>Maps prompt to the right skill chain</span></div>
                  </div>
                  <div className="route-item">
                    <div className="route-icon"><Zap className="h-4 w-4" /></div>
                    <div><strong>Workers run in sequence</strong><span>On-chain, market, and execution tools</span></div>
                  </div>
                  <div className="route-item">
                    <div className="route-icon"><FileText className="h-4 w-4" /></div>
                    <div><strong>Report + artifacts ship</strong><span>Final brief, logs, and workflow state</span></div>
                  </div>
                </div>
              </aside>
            </section>

            <section className="composer-panel" aria-label="Create workflow">
              <div className="composer-header">
                <div className="composer-title">
                  <Sparkles className="h-4 w-4 text-[#828fff]" />
                  New agent task
                </div>
                <div className="composer-meta">Enter to run · Shift+Enter newline</div>
              </div>
              <div className="composer-input">
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Example: Scan BTC on-chain metrics, compare 4h signals, and send a Telegram alert if momentum turns bearish…"
                  disabled={submitting}
                />
              </div>

              {/* Stats Ticker */}
              <div className="px-[22px] py-2 border-t border-b border-white/[0.04] bg-white/[0.01] flex items-center justify-center gap-1 sm:gap-2 text-[11px] font-mono text-white/40">
                <span className="flex items-center gap-1 shrink-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span className="text-white/70 font-semibold">{tickerStats.onlineAgents}</span> agents online
                </span>
                <span className="shrink-0">·</span>
                <span className="shrink-0">
                  <span className="text-white/70 font-semibold">{tickerStats.jobsSettled.toLocaleString()}</span> jobs settled
                </span>
                <span className="shrink-0">·</span>
                <span className="shrink-0">
                  <span className="text-white/70 font-semibold">{tickerStats.totalPaidUsdc.toFixed(2)}</span> USDC paid out
                </span>
              </div>

              <div className="prompt-examples" aria-label="Example prompts">
                {EXAMPLE_PROMPTS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="prompt-chip"
                    onClick={() => fillPrompt(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
              <div className="composer-actions">
                <span className="composer-hint">
                  Pick a template below if you want a pre-wired agent chain.
                </span>
                <button
                  className="run-button"
                  onClick={() => submit(prompt)}
                  disabled={!prompt.trim() || submitting || !ready}
                >
                  {submitting ? (
                    <>
                      Launching <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </>
                  ) : (
                    <>
                      Launch workflow <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </section>

            <section className="templates-section" aria-label="Workflow templates">
              <div className="templates-head">
                <div>
                  <div className="templates-kicker"><Network className="h-3.5 w-3.5" /> Workflow templates</div>
                  <h2>Start from a proven agent chain.</h2>
                  <p>Structured prompts for common crypto research, monitoring, and execution workflows.</p>
                </div>
                <div className="templates-count">{WORKFLOW_TEMPLATES.length} templates</div>
              </div>

              <div className="workflow-grid">
                {WORKFLOW_TEMPLATES.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    onUse={fillPrompt}
                    agentsList={agentsList}
                  />
                ))}
              </div>
            </section>

            {/* Khối B — Live Agent Roster */}
            <section className="templates-section mt-8" aria-label="Live Agent Roster">
              <div className="templates-head">
                <div>
                  <div className="templates-kicker text-emerald-400">
                    <span className="relative flex h-1.5 w-1.5 mr-1 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                    Live Agent Roster
                  </div>
                  <h2>Active Agent Providers</h2>
                  <p>Real-time registry lookup of available ERC-8004 agents and their pricing.</p>
                </div>
                <div className="templates-count border-emerald-400/20 text-emerald-400 font-mono">
                  {agentsList.filter((a) => a.status === 'online').length} online
                </div>
              </div>

              {agentsList.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-xs text-white/30 italic">
                  No agents active in the registry.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 mt-4">
                  {agentsList.slice(0, 4).map((agent) => {
                    const stars = agent.reputation != null ? (agent.reputation / 20).toFixed(1) : null
                    const statusColor = agent.status === 'online' ? 'bg-emerald-400 animate-pulse' : agent.status === 'busy' ? 'bg-amber-400 animate-pulse' : 'bg-white/20'
                    return (
                      <div key={agent.slug} className="border border-white/[0.08] bg-white/[0.02] hover:border-white/15 rounded-xl p-3.5 flex flex-col justify-between transition-colors">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] uppercase font-mono tracking-wider text-white/40">{agent.category}</span>
                            <span className="flex items-center gap-1.5">
                              <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
                              <span className="text-[9px] uppercase font-mono text-white/50">{agent.status}</span>
                            </span>
                          </div>
                          <h4 className="text-sm font-semibold text-white/90 truncate mb-1">{agent.name}</h4>
                          <p className="text-[11px] text-white/35 font-mono mb-3">{agent.pricePerCall} USDC/call</p>
                        </div>
                        <div className="flex items-center justify-between border-t border-white/[0.04] pt-2 text-[10px]">
                          <span className="text-white/40 font-mono">{agent.totalCalls} calls</span>
                          {stars ? (
                            <span className="text-amber-400 font-semibold">{stars}★ reputation</span>
                          ) : (
                            <span className="text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded font-mono text-[9px] font-bold">NEW</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Footer link to Directory */}
              <div className="mt-4 flex justify-end">
                <Link href="/agents" className="text-xs text-[#828fff] hover:underline flex items-center gap-1 font-semibold">
                  Browse all agents →
                </Link>
              </div>
            </section>

            {ready && !authenticated && (
              <p className="mt-5 text-center text-xs text-white/35">
                Connect your wallet via the header to create workflows.
              </p>
            )}
          </div>
        </main>
      </div>
    </>
  )
}

function TemplateCard({
  template,
  onUse,
  agentsList,
}: {
  template: WorkflowTemplate
  onUse: (prompt: string) => void
  agentsList: any[]
}) {
  const steps = [template.skillName, ...(template.followupSkills || [])].filter(Boolean) as string[]
  const visibleAgents = template.uses.slice(0, 3)
  const hiddenAgents = Math.max(0, template.uses.length - visibleAgents.length)

  // Dynamic estimate of the cost
  let estimatedCost = 0
  template.uses.forEach((skillSlug) => {
    const agent = agentsList.find((a) => a.slug === skillSlug)
    if (agent) {
      estimatedCost += parseFloat(agent.pricePerCall)
    } else {
      const fallbackCost = skillSlug === 'report-composer' ? 0.01 :
                           skillSlug === 'crypto-scanner' ? 0.005 :
                           skillSlug === 'defi-yields' ? 0.005 :
                           skillSlug === 'trading-signals' ? 0.005 :
                           skillSlug === 'whale-tracker' ? 0.008 :
                           skillSlug === 'telegram-sender' ? 0.002 :
                           skillSlug === 'email-sender' ? 0.002 : 0.01
      estimatedCost += fallbackCost
    }
  })

  // Pretty chain preview names
  const shortChainNames = template.uses.map((slug) => {
    switch (slug) {
      case 'crypto-scanner': return 'Birdeye'
      case 'trading-signals': return 'RSI Agent'
      case 'telegram-sender': return 'Telegram Bot'
      case 'email-sender': return 'Email Bot'
      case 'defi-yields': return 'Yield Hunter'
      case 'whale-tracker': return 'Whale Tracker'
      case 'report-composer': return 'Composer'
      default: return getSkillActionName(slug)
    }
  })

  return (
    <article className={`wf-card wf-card-${template.category}`}>
      <div className="wf-top">
        <span className="wf-badge">{CATEGORY_COPY[template.category]}</span>
        <span className="wf-emoji" aria-hidden>{template.emoji}</span>
      </div>

      <h3 className="wf-title">{template.title}</h3>
      <p className="wf-desc">{template.desc}</p>

      {/* Mini Agent Chain Preview */}
      <div className="wf-agents mt-3" aria-label="Mini agent chain preview">
        {shortChainNames.map((name, idx) => (
          <React.Fragment key={idx}>
            <span className="agent-chip">{name}</span>
            {idx < shortChainNames.length - 1 && <span className="text-[9px] text-white/20 self-center">→</span>}
          </React.Fragment>
        ))}
      </div>

      <div className="wf-flow" aria-label="Estimated Cost">
        <span>Estimated Cost:</span>
        <strong className="ml-1 text-cyan-400 font-mono">~{estimatedCost.toFixed(3)} USDC</strong>
      </div>

      <button
        type="button"
        className="use-btn"
        onClick={() => onUse(template.slottedPrompt ?? template.prompt)}
      >
        Use this chain <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </article>
  )
}
