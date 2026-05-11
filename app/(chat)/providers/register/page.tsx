'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, CheckCircle2, Loader2, Plus, ServerCog } from 'lucide-react'

import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'

const DEFAULT_SCHEMA = `{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": {
      "type": "string",
      "description": "What the agent should analyze"
    }
  }
}`

const INPUT_CLS =
  'w-full border-2 border-black bg-[#0f131c] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[var(--giga-accent)]'

export default function RegisterProviderPage() {
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [category, setCategory] = useState('research')
  const [costCredits, setCostCredits] = useState(8)
  const [inputSchema, setInputSchema] = useState(DEFAULT_SCHEMA)
  const [keywords, setKeywords] = useState('')
  const [providerApis, setProviderApis] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; skillName?: string } | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setResult(null)
    try {
      const parsedSchema = JSON.parse(inputSchema) as Record<string, unknown>
      const res = await fetch('/api/providers/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          displayName,
          description,
          endpoint,
          category,
          costCredits,
          inputSchema: parsedSchema,
          keywords: splitList(keywords),
          providerApis: splitList(providerApis),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setResult({ ok: true, message: 'Provider registered as a draft agent.', skillName: json.skill?.name })
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="giga-theme flex h-full w-full flex-col">
      <MainHeader />
      <div className="flex flex-1 overflow-hidden">
        <HistorySidebar />
        <AppRail />
        <main className="flex-1 overflow-y-auto bg-[#0f131c] p-4 sm:p-8">
          <div className="mx-auto w-full max-w-4xl">
            <div className="mb-6 flex items-center gap-3">
              <Link
                href="/agents"
                className="inline-flex h-8 w-8 items-center justify-center border-2 border-black bg-[var(--giga-panel)] text-white/70 hover:text-white"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div>
                <h1 className="font-pixel-header text-xl text-white sm:text-2xl">
                  Register provider agent
                </h1>
                <p className="mt-1 text-sm text-white/50">
                  Add an HTTPS skill endpoint to the marketplace. Minting to ERC-8004 can happen after review.
                </p>
              </div>
            </div>

            <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[1fr_18rem]">
              <div className="space-y-4">
                <Panel title="Agent identity">
                  <Field label="Slug">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="wallet-risk-checker"
                      className={INPUT_CLS}
                      required
                    />
                  </Field>
                  <Field label="Display name">
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Wallet Risk Checker"
                      className={INPUT_CLS}
                      required
                    />
                  </Field>
                  <Field label="Description">
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Explain what your agent does, what data it uses, and when users should pick it."
                      className={`${INPUT_CLS} min-h-28 resize-y`}
                      required
                    />
                  </Field>
                </Panel>

                <Panel title="Runtime">
                  <Field label="HTTPS endpoint">
                    <input
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder="https://api.example.com/gigawork/skill"
                      className={INPUT_CLS}
                      required
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Category">
                      <input value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT_CLS} />
                    </Field>
                    <Field label="Cost credits">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={costCredits}
                        onChange={(e) => setCostCredits(Number(e.target.value))}
                        className={INPUT_CLS}
                      />
                    </Field>
                  </div>
                </Panel>

                <Panel title="Input contract">
                  <Field label="JSON schema">
                    <textarea
                      value={inputSchema}
                      onChange={(e) => setInputSchema(e.target.value)}
                      className={`${INPUT_CLS} min-h-52 resize-y font-mono text-xs`}
                    />
                  </Field>
                </Panel>
              </div>

              <aside className="space-y-4">
                <Panel title="Discovery">
                  <Field label="Keywords">
                    <textarea
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      placeholder="wallet, risk, compliance"
                      className={`${INPUT_CLS} min-h-20 resize-y`}
                    />
                  </Field>
                  <Field label="Provider APIs">
                    <textarea
                      value={providerApis}
                      onChange={(e) => setProviderApis(e.target.value)}
                      placeholder="Alchemy, Etherscan"
                      className={`${INPUT_CLS} min-h-20 resize-y`}
                    />
                  </Field>
                </Panel>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex w-full items-center justify-center gap-2 border-2 border-black bg-[var(--giga-accent)] px-4 py-3 text-sm font-bold text-black transition hover:bg-yellow-300 disabled:cursor-wait disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Register draft
                </button>

                {result && (
                  <div
                    className={`border-2 px-3 py-3 text-sm ${
                      result.ok
                        ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                        : 'border-red-400/40 bg-red-500/10 text-red-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <ServerCog className="h-4 w-4" />}
                      <span>{result.message}</span>
                    </div>
                    {result.skillName && (
                      <Link href={`/agents/${result.skillName}`} className="mt-2 block text-xs text-cyan-200 hover:underline">
                        Open agent profile
                      </Link>
                    )}
                  </div>
                )}
              </aside>
            </form>
          </div>
        </main>
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-2 border-black bg-[var(--giga-panel)]">
      <div className="border-b-2 border-black bg-[var(--giga-sidebar)] px-4 py-2 text-xs uppercase tracking-wider text-white/65">
        {title}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">{label}</span>
      {children}
    </label>
  )
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
