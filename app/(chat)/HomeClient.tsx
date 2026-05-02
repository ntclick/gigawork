'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { IdentityGate } from '@/components/auth/IdentityGate'
import { TemplateCard } from '@/components/home/TemplateCard'
import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'
import { WORKFLOW_TEMPLATES } from '@/lib/workflowTemplates'

type Me = { id: string; wallet: string; credits: number }

export function HomeClient() {
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
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

  const submit = async (overridePrompt?: string) => {
    const v = (overridePrompt ?? prompt).trim()
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
      const { id } = (await r.json()) as { id: string }
      router.push(`/workflow/${id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to start')
      setSubmitting(false)
    }
  }

  return (
    <>
      <MainHeader />
      <div className="giga-theme flex flex-1 overflow-hidden bg-[var(--giga-dark)]">
        <AppRail />
        <HistorySidebar />

        <main className="giga-grid-bg flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-5 py-10 sm:px-8 sm:py-14 lg:py-16">
          <header className="mb-8 text-center sm:mb-10">
            <h2 className="font-pixel-header mb-2 text-3xl font-bold text-white sm:text-4xl lg:text-5xl">
              What do you want to automate?
            </h2>
            <p className="text-base text-white/65 sm:text-xl">
              Pick a template to fill a form, or type freely below.
            </p>
          </header>

          <IdentityGate mode="banner">
            <section className="mb-10 sm:mb-14">
              <div className="border-2 border-[var(--giga-accent)] p-2">
                <div className="relative bg-[var(--giga-panel)] p-4 sm:p-6">
                  <textarea
                    autoFocus
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault()
                        submit()
                      }
                    }}
                    placeholder="e.g., Scan PEPE on Ethereum + check Twitter sentiment, then compose a report…"
                    rows={4}
                    maxLength={4000}
                    className="min-h-[110px] w-full resize-none border-none bg-transparent pr-20 text-lg leading-relaxed text-white outline-none placeholder:text-white/30 sm:text-xl"
                    style={{ fontFamily: 'inherit' }}
                  />
                  <div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4">
                    <button
                      onClick={() => submit()}
                      disabled={prompt.trim().length < 4 || submitting}
                      className="border-2 border-black bg-[var(--giga-accent)] px-6 py-1.5 text-sm font-bold text-black transition hover:bg-yellow-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:px-8 sm:py-2 sm:text-base"
                    >
                      {submitting ? 'SENDING…' : 'SEND'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-white/40">
                <span>
                  {me ? `${me.credits} cr · $${(me.credits / 100).toFixed(2)}` : '—'}
                </span>
                <span>
                  {prompt.trim().length}/4000 · ⌘+Enter to send
                </span>
              </div>
              {err && (
                <div className="mt-3 border-2 border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {err}
                </div>
              )}
            </section>

            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-pixel-header text-base text-white/90">
                Templates
              </h3>
              <span className="text-xs uppercase tracking-wider text-white/45">
                Click any to configure
              </span>
            </div>

            <section
              data-purpose="template-gallery"
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 lg:gap-6"
            >
              {WORKFLOW_TEMPLATES.map((tpl) => (
                <TemplateCard
                  key={tpl.id}
                  template={tpl}
                  expanded={expandedId === tpl.id}
                  dimmed={expandedId !== null && expandedId !== tpl.id}
                  userCredits={me?.credits}
                  onToggle={() =>
                    setExpandedId((cur) => (cur === tpl.id ? null : tpl.id))
                  }
                  onFillFreeText={(p) => {
                    setPrompt(p)
                    setExpandedId(null)
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                  onSubmit={async (envelope) => {
                    await submit(envelope)
                  }}
                />
              ))}
            </section>
          </IdentityGate>
        </div>
      </main>
      </div>
    </>
  )
}
