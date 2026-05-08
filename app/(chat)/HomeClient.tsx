'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, Coins, Sparkles, Zap } from 'lucide-react'

import { IdentityGate } from '@/components/auth/IdentityGate'
import { EditablePrompt } from '@/components/home/EditablePrompt'
import type { Segment as PromptSegment } from '@/lib/slottedPrompt'
import { TemplateForm } from '@/components/home/TemplateForm'
import { TemplateCard } from '@/components/home/TemplateCard'
import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'
import { useEscrowPost } from '@/lib/hooks/useEscrowPost'
import {
  parseSlottedPrompt,
  serializeSlottedPrompt,
  type Segment,
} from '@/lib/slottedPrompt'
import { WORKFLOW_TEMPLATES } from '@/lib/workflowTemplates'

type Me = { id: string; wallet: string; credits: number; identity?: { hasIdentity: boolean } }

// Map useEscrowPost step → button label so user sees what wallet popup
// they're being shown. 'idle' = no escrow step active = generic spinner.
function escrowLabel(step: ReturnType<typeof useEscrowPost>['step']): string {
  switch (step) {
    case 'preparing':       return 'Preparing…'
    case 'signing-create':  return 'Sign create…'
    case 'posting-create':  return 'Confirming…'
    case 'signing-approve': return 'Sign approve…'
    case 'signing-fund':    return 'Sign fund…'
    case 'confirming':      return 'Confirming…'
    default:                return 'Sending…'
  }
}

const CATEGORIES = [
  { key: 'all', label: 'All', icon: '⚡' },
  { key: 'research', label: 'Research', icon: '🔍' },
  { key: 'on-chain', label: 'On-chain', icon: '⛓️' },
  { key: 'execution', label: 'Trading', icon: '📈' },
] as const

export function HomeClient() {
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('all')
  // Slotted prompt mode: when a slot-aware template is loaded, segments !== null
  // and we render <EditablePrompt> instead of the raw <textarea>. Switching back
  // to raw mode (user clicks "edit raw" or types into textarea) clears segments.
  const [segments, setSegments] = useState<Segment[] | null>(null)
  const [promptFocused, setPromptFocused] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const ex = searchParams?.get('expand')
    if (ex && WORKFLOW_TEMPLATES.some((t) => t.id === ex)) {
      setExpandedId(ex)
    }
  }, [searchParams])

  useEffect(() => {
    const refresh = () =>
      fetch('/api/me', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setMe(j))
        .catch(() => {})
    refresh()
    const onBust = () => refresh()
    window.addEventListener('gw:credits-changed', onBust)
    return () => window.removeEventListener('gw:credits-changed', onBust)
  }, [])

  const filteredTemplates = useMemo(
    () =>
      activeCategory === 'all'
        ? WORKFLOW_TEMPLATES
        : WORKFLOW_TEMPLATES.filter((t) => t.category === activeCategory),
    [activeCategory],
  )

  const escrow = useEscrowPost()
  const submit = async (overridePrompt?: string) => {
    // Resolution order: explicit override → serialized slot segments → textarea
    const v = (
      overridePrompt ??
      (segments ? serializeSlottedPrompt(segments) : prompt)
    ).trim()
    if (v.length < 4 || submitting) return
    setSubmitting(true)
    setErr(null)
    try {
      const r = await fetch('/api/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: v }),
      })
      if (!r.ok) throw new Error(await r.text())
      const { id, escrow: mode } = (await r.json()) as {
        id: string
        escrow?: 'user-client' | 'admin' | 'off'
      }

      // When the server signals user-client mode, drive the 3-step Privy
      // flow before navigating to the workflow page so the user sees the
      // wallet popups in the home context they came from. If escrow fails,
      // we still navigate — the workflow itself runs off-chain regardless.
      if (mode === 'user-client') {
        try {
          await escrow.post(id)
        } catch (e) {
          console.warn('[home] escrow.post failed', e instanceof Error ? e.message : e)
        }
      }

      router.push(`/workflow/${id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to start')
      setSubmitting(false)
    }
  }

  const promptText = segments ? serializeSlottedPrompt(segments) : prompt

  return (
    <>
      <MainHeader />
      <div className="giga-theme flex flex-1 overflow-hidden bg-[var(--giga-dark)]">
        <AppRail />
        <HistorySidebar />

        <main className="giga-grid-bg flex flex-1 flex-col overflow-y-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-8 sm:px-8 sm:py-10 lg:py-12">

            {/* ─── HERO: compact, no wasted space ─── */}
            <header className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
              <div>
                <h2 className="font-pixel-header mb-1 text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
                  What do you want to automate?
                </h2>
                <p className="text-sm text-white/50 sm:text-base">
                  Pick a template below or type your own prompt.
                </p>
              </div>
              {me && (
                <div className="gw-fade-in flex shrink-0 items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.05] px-3 py-2">
                  <Coins className="h-4 w-4 text-cyan-300" />
                  <span className="font-mono text-sm font-semibold text-cyan-200">
                    {me.credits} cr
                  </span>
                  <span className="text-xs text-white/35">
                    · ${(me.credits / 100).toFixed(2)}
                  </span>
                </div>
              )}
            </header>

            <IdentityGate mode="banner">
              {/* ─── CATEGORY TABS ─── */}
              <div className="mb-5 flex items-center gap-1.5 overflow-x-auto pb-1 sm:gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => {
                      setActiveCategory(cat.key)
                      setExpandedId(null)
                    }}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium tracking-wide transition sm:px-4 sm:text-sm ${
                      activeCategory === cat.key
                        ? 'bg-[var(--giga-accent)]/15 text-[var(--giga-accent)] ring-1 ring-[var(--giga-accent)]/30'
                        : 'bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/70'
                    }`}
                  >
                    <span>{cat.icon}</span>
                    {cat.label}
                    {cat.key !== 'all' && (
                      <span className="ml-0.5 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/35">
                        {WORKFLOW_TEMPLATES.filter(
                          (t) => t.category === cat.key,
                        ).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* ─── TEMPLATE GRID ─── */}
              <section
                data-purpose="template-gallery"
                className="gw-stagger mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4"
              >
                {filteredTemplates.map((tpl, i) => (
                  <div key={tpl.id} style={{ '--i': i } as React.CSSProperties}>
                    <TemplateCard
                      template={tpl}
                      expanded={expandedId === tpl.id}
                      dimmed={expandedId !== null && expandedId !== tpl.id}
                      userCredits={me?.credits}
                      onToggle={() =>
                        setExpandedId((cur) => (cur === tpl.id ? null : tpl.id))
                      }
                      onFillFreeText={(p) => {
                        // If the template has a slotted form, parse and load
                        // segments — that switches the input area to the
                        // EditablePrompt with clickable chips. Otherwise fall
                        // back to the plain textarea path so legacy templates
                        // keep working unchanged.
                        if (tpl.slottedPrompt) {
                          setSegments(parseSlottedPrompt(tpl.slottedPrompt))
                          setPrompt('')
                        } else {
                          setSegments(null)
                          setPrompt(p)
                        }
                        setExpandedId(null)
                        // Scroll to bottom prompt bar
                        setTimeout(() => {
                          document.getElementById('gw-prompt-bar')?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center',
                          })
                        }, 100)
                      }}
                    />
                  </div>
                ))}
              </section>

              {/* ─── OR DIVIDER ─── */}
              <div className="mb-5 flex items-center gap-4">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-white/30">
                  <Zap className="h-3 w-3" />
                  Or describe your task
                </span>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              </div>

              {/* ─── PROMPT INPUT (compact, bottom-aligned) ─── */}
              <section id="gw-prompt-bar" className="mb-6">
                <div
                  className={`overflow-hidden rounded-xl border transition-all ${
                    promptFocused || promptText.trim().length > 0
                      ? 'border-[var(--giga-accent)]/40 bg-[var(--giga-panel)] shadow-[0_0_24px_rgba(255,204,77,0.06)]'
                      : 'border-white/[0.08] bg-[var(--giga-panel)]/60 hover:border-white/[0.14]'
                  }`}
                >
                  <div className="relative p-3 sm:p-4">
                    {segments ? (
                      <div
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                            e.preventDefault()
                            submit()
                          }
                        }}
                      >
                        <EditablePrompt
                          segments={segments}
                          onChange={setSegments}
                          onEditRaw={() => {
                            setPrompt(serializeSlottedPrompt(segments))
                            setSegments(null)
                          }}
                        />
                      </div>
                    ) : (
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onFocus={() => setPromptFocused(true)}
                        onBlur={() => setPromptFocused(false)}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                            e.preventDefault()
                            submit()
                          }
                        }}
                        placeholder="e.g., Scan PEPE on Ethereum + check Twitter sentiment, then compose a report…"
                        rows={2}
                        maxLength={4000}
                        className="min-h-[56px] w-full resize-none border-none bg-transparent pr-16 text-sm leading-relaxed text-white outline-none placeholder:text-white/25 sm:text-base"
                        style={{ fontFamily: 'inherit' }}
                      />
                    )}
                    <div className="absolute right-3 bottom-3 sm:right-4 sm:bottom-4">
                      <button
                        onClick={() => submit()}
                        disabled={promptText.trim().length < 4 || submitting || !me?.identity?.hasIdentity}
                        className="gw-shine inline-flex items-center gap-1.5 rounded-lg bg-[var(--giga-accent)] px-4 py-2 text-xs font-bold text-black transition hover:bg-yellow-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 sm:px-5 sm:text-sm"
                      >
                        {submitting ? (
                          <>
                            <span className="gw-spinner h-3.5 w-3.5" />
                            {escrowLabel(escrow.step)}
                          </>
                        ) : !me?.identity?.hasIdentity ? (
                          <>
                            Mint to Run
                          </>
                        ) : (
                          <>
                            <ArrowUp className="h-3.5 w-3.5" />
                            Run
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Footer info row */}
                  <div className="flex items-center justify-between border-t border-white/[0.05] px-3 py-1.5 text-[11px] text-white/30 sm:px-4">
                    <span>
                      {promptText.trim().length}/4000
                    </span>
                    <span>
                      ⌘+Enter to run
                    </span>
                  </div>
                </div>

                {err && (
                  <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {err}
                  </div>
                )}
              </section>
            </IdentityGate>
          </div>
        </main>
      </div>

      {/* ─── TEMPLATE CONFIG MODAL (Lifted outside grid to avoid transform clipping) ─── */}
      {expandedId && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setExpandedId(null)}
        >
          <div 
            className="w-full max-w-md overflow-hidden rounded-xl border border-[var(--giga-accent)]/50 bg-[var(--giga-panel)] shadow-[0_8px_32px_rgba(255,204,77,0.15)]"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === expandedId)
              if (!tpl) return null
              return (
                <>
                  {/* Modal header */}
                  <div className="flex items-center justify-between border-b border-white/5 bg-[var(--giga-sidebar)] px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xl leading-none">{tpl.emoji}</span>
                      <h3 className="font-pixel-body text-base text-white">{tpl.title}</h3>
                    </div>
                  </div>
                  <TemplateForm
                    template={tpl}
                    userCredits={me?.credits}
                    hasIdentity={me?.identity?.hasIdentity ?? false}
                    onSubmit={async (envelope) => {
                      setExpandedId(null)
                      await submit(envelope)
                    }}
                    onCancel={() => setExpandedId(null)}
                  />
                </>
              )
            })()}
          </div>
        </div>
      )}
    </>
  )
}
