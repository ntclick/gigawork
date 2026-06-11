'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { ArrowRight, Pencil, Network, Loader2 } from 'lucide-react'

import { MainHeader } from '@/components/shell/MainHeader'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { AppRail } from '@/components/shell/AppRail'
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@/lib/workflowTemplates'
import { toast } from '@/components/ui/toast'

function getSkillActionName(name: string): string {
  switch (name) {
    case 'crypto-scanner': return 'Scan'
    case 'report-composer':
    case 'report-composer-fast':
      return 'Summarize'
    case 'telegram-sender': return 'Push alert'
    case 'defi-yields': return 'Find pools'
    case 'whale-tracker': return 'Monitor wallet'
    case 'trading-signals': return 'Analyze RSI'
    case 'email-sender': return 'Email'
    default: return name
  }
}

export function HomeClient() {
  const router = useRouter()
  const { ready, authenticated } = usePrivy()
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [prompt])

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

  return (
    <>
      <MainHeader />
      <div className="giga-theme gw-main-shell">
        <AppRail />
        <HistorySidebar />

        <main className="flex flex-1 flex-col overflow-y-auto orch-container bg-[#08090d]">
          <style dangerouslySetInnerHTML={{ __html: `
            .orch-container {
              --color-background-primary: #12101f;
              --color-background-secondary: #1a172e;
              --color-background-tertiary: #08090d;
              --color-border-tertiary: rgba(255, 255, 255, 0.08);
              --color-text-primary: #ffffff;
              --color-text-secondary: rgba(255, 255, 255, 0.4);
              --font-sans: var(--font-sans), system-ui, sans-serif;
              --font-mono: var(--font-mono), monospace;
              --border-radius-lg: 12px;
              --border-radius-md: 8px;
            }
            .orch-body {
              display: flex;
              flex-direction: column;
              align-items: center;
              padding: 40px 24px 36px;
              width: 100%;
            }
            .orch-hero {
              text-align: center;
              margin-bottom: 24px;
            }
            .orch-hero h1 {
              font-size: 22px;
              font-weight: 500;
              color: #fff;
              letter-spacing: -0.4px;
              margin-bottom: 6px;
            }
            .orch-hero p {
              font-size: 12px;
              color: rgba(255, 255, 255, 0.3);
              line-height: 1.6;
            }
            .composer {
              width: 100%;
              max-width: 560px;
              background: rgba(255, 255, 255, 0.03);
              border: 0.5px solid rgba(255, 255, 255, 0.09);
              border-radius: 10px;
              overflow: hidden;
              transition: border-color 0.2s;
              margin-bottom: 36px;
            }
            .composer:focus-within {
              border-color: rgba(167, 139, 250, 0.35);
            }
            .composer textarea {
              width: 100%;
              background: transparent;
              border: none;
              padding: 14px 16px 10px;
              font-size: 13px;
              color: rgba(255, 255, 255, 0.65);
              font-family: inherit;
              resize: none;
              min-height: 72px;
              outline: none;
              line-height: 1.6;
            }
            .composer textarea::placeholder {
              color: rgba(255, 255, 255, 0.18);
            }
            .composer-foot {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 8px 12px 10px;
              border-top: 0.5px solid rgba(255, 255, 255, 0.05);
            }
            .hint {
              font-size: 11px;
              color: rgba(255, 255, 255, 0.16);
            }
            .go {
              padding: 5px 14px;
              background: rgba(167, 139, 250, 0.15);
              border: 0.5px solid rgba(167, 139, 250, 0.3);
              border-radius: 6px;
              color: #a78bfa;
              font-size: 12px;
              font-weight: 500;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 5px;
              transition: all 0.2s;
            }
            .go:hover:not(:disabled) {
              background: rgba(167, 139, 250, 0.25);
            }
            .go:disabled {
              opacity: 0.4;
              cursor: not-allowed;
            }
            .orch-label {
              width: 100%;
              max-width: 640px;
              font-size: 11px;
              color: rgba(255, 255, 255, 0.2);
              letter-spacing: 0.1em;
              text-transform: uppercase;
              margin-bottom: 16px;
              display: flex;
              align-items: center;
              gap: 10px;
            }
            .orch-label::after {
              content: '';
              flex: 1;
              height: 0.5px;
              background: rgba(255, 255, 255, 0.05);
            }
            .orch-grid {
              width: 100%;
              max-width: 640px;
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 10px;
            }
            @media (max-width: 768px) {
              .orch-grid {
                grid-template-columns: 1fr;
              }
            }
            @media (min-width: 769px) and (max-width: 1024px) {
              .orch-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
              }
            }
            .wf-card {
              background: #0e0e14;
              border: 0.5px solid rgba(255, 255, 255, 0.07);
              border-radius: 10px;
              padding: 14px;
              cursor: pointer;
              transition: border-color 0.18s, background 0.18s;
              display: flex;
              flex-direction: column;
              gap: 10px;
              position: relative;
            }
            .wf-card:hover {
              border-color: rgba(167, 139, 250, 0.25);
              background: #111119;
            }
            .wf-head {
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 8px;
            }
            .wf-title {
              font-size: 12px;
              font-weight: 500;
              color: #d4d4dc;
              line-height: 1.35;
              flex: 1;
            }
            .status-dot {
              width: 6px;
              height: 6px;
              border-radius: 50%;
              flex-shrink: 0;
              margin-top: 3px;
            }
            .s-live {
              background: #a78bfa;
            }
            .s-idle {
              background: rgba(255, 255, 255, 0.18);
            }
            .s-warn {
              background: #c98a1f;
            }
            .agents-row {
              display: flex;
              flex-wrap: wrap;
              gap: 5px;
            }
            .agent-chip {
              display: flex;
              align-items: center;
              gap: 4px;
              font-size: 10px;
              color: rgba(255, 255, 255, 0.35);
              background: rgba(255, 255, 255, 0.04);
              border: 0.5px solid rgba(255, 255, 255, 0.08);
              padding: 2px 7px;
              border-radius: 4px;
              white-space: nowrap;
            }
            .agent-chip.live {
              color: rgba(167, 139, 250, 0.8);
              background: rgba(167, 139, 250, 0.07);
              border-color: rgba(167, 139, 250, 0.18);
            }
            .ac-dot {
              width: 4px;
              height: 4px;
              border-radius: 50%;
              background: rgba(255, 255, 255, 0.25);
            }
            .ac-dot.live {
              background: #a78bfa;
            }
            .flow {
              display: flex;
              align-items: center;
              gap: 4px;
              flex-wrap: wrap;
            }
            .fn {
              font-size: 10px;
              color: rgba(255, 255, 255, 0.28);
              white-space:nowrap;
            }
            .fa {
              color: rgba(167, 139, 250, 0.4);
              font-size: 10px;
            }
            .use-btn {
              width: 100%;
              padding: 6px 0;
              background: transparent;
              border: 0.5px solid rgba(255, 255, 255, 0.09);
              border-radius: 6px;
              color: rgba(255, 255, 255, 0.35);
              font-size: 11px;
              cursor: pointer;
              transition: all 0.15s;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 5px;
              margin-top: 2px;
            }
            .use-btn:hover {
              background: rgba(167, 139, 250, 0.1);
              border-color: rgba(167, 139, 250, 0.25);
              color: #a78bfa;
            }
          ` }} />

          <div className="orch-body">
            {/* Hero */}
            <div className="orch-hero">
              <h1>What should the agents do?</h1>
              <p>Describe a task — Hermes will plan and dispatch the right AI agents.</p>
            </div>

            {/* Composer Box */}
            <div className="composer">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKey}
                placeholder="e.g. Scan BTC on-chain metrics and send a Telegram alert…"
                disabled={submitting}
              />
              <div className="composer-foot">
                <span className="hint">Shift+Enter for newline</span>
                <button
                  className="go"
                  onClick={() => submit(prompt)}
                  disabled={!prompt.trim() || submitting || !ready}
                >
                  {submitting ? (
                    <>
                      Running <Loader2 className="h-3 w-3 animate-spin" />
                    </>
                  ) : (
                    <>
                      Run <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Workflow Templates Header */}
            <div className="orch-label">
              <Network className="h-3.5 w-3.5 mr-1" />
              Workflow templates
            </div>

            {/* Grid of Templates */}
            <div className="orch-grid">
              {WORKFLOW_TEMPLATES.map((tpl) => (
                <TemplateCard
                  key={tpl.id}
                  template={tpl}
                  onUse={(p) => {
                    setPrompt(p)
                    textareaRef.current?.focus()
                  }}
                />
              ))}
            </div>

            {/* Not logged in notice */}
            {ready && !authenticated && (
              <p className="mt-8 text-center text-xs text-white/30">
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
}: {
  template: WorkflowTemplate
  onUse: (prompt: string) => void
}) {
  let statusClass = 's-idle'
  let chipClass = ''
  let dotClass = ''
  
  if (template.id.includes('scanner') || template.id.includes('whale') || template.id.includes('signals')) {
    statusClass = 's-live'
    chipClass = 'live'
    dotClass = 'live'
  } else if (template.id.includes('yield')) {
    statusClass = 's-idle'
  }

  const steps = [template.skillName, ...(template.followupSkills || [])].filter(Boolean) as string[]

  return (
    <div className="wf-card">
      <div className="wf-head">
        <span className="wf-title">{template.title}</span>
        <span className={`status-dot ${statusClass}`}></span>
      </div>
      <div className="agents-row">
        {template.uses.map((s) => (
          <span key={s} className={`agent-chip ${chipClass}`}>
            <span className={`ac-dot ${dotClass}`}></span>
            {s}
          </span>
        ))}
      </div>
      <div className="flow">
        {steps.map((s, idx) => (
          <React.Fragment key={s}>
            <span className="fn">{getSkillActionName(s)}</span>
            {idx < steps.length - 1 && <span className="fa">→</span>}
          </React.Fragment>
        ))}
      </div>
      <button
        className="use-btn"
        onClick={() => onUse(template.prompt)}
      >
        <Pencil className="h-3 w-3" /> Use prompt
      </button>
    </div>
  )
}
