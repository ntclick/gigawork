'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Loader2 } from 'lucide-react'

import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'
import { WORKFLOW_TEMPLATES } from '@/lib/workflowTemplates'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
const PINATA_GATEWAY = process.env.NEXT_PUBLIC_PINATA_GATEWAY ?? 'https://gateway.pinata.cloud/ipfs/'

interface AgentDetail {
  name: string
  manifest: Record<string, unknown> & {
    display_name?: string
    description?: string
    category?: string
    cost_credits?: number
    best_for_keywords?: string[]
    input_schema?: { properties?: Record<string, { type?: string; description?: string }> }
    provider_apis?: string[]
    on_chain?: { ipfs_uri?: string; tx_hash?: string; owner?: string }
  }
  agent_token_id: string | null
  agent_tx_hash: string | null
  agent_minted_at: string | null
  stats: {
    total_dispatches: number
    completed: number
    failed: number
    success_rate: number | null
    total_credits_earned: number
  }
  recent_dispatches: Array<{
    messageId: string
    workflowId: string
    tx: string | null
    input: unknown
    createdAt: string
  }>
}

export default function AgentDetailPage() {
  const params = useParams<{ name: string }>()
  const router = useRouter()
  const name = params?.name ?? ''
  const [data, setData] = useState<AgentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!name) return
    fetch(`/api/agents/${name}/stats`)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((j: AgentDetail) => setData(j))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [name])

  // Find a template that uses this skill — for the "Try this agent" CTA
  const template = WORKFLOW_TEMPLATES.find((t) => t.skillName === name)

  const tryAgent = async () => {
    if (template) {
      // Go home with template id in hash so home auto-expands it
      router.push(`/?expand=${template.id}`)
    } else {
      router.push('/')
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
              <h1 className="font-pixel-header text-xl text-white sm:text-2xl">
                {data?.manifest.display_name ?? name}
              </h1>
            </div>

            {error && (
              <div className="border-2 border-red-400/40 bg-red-500/10 px-3 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {!data && !error && (
              <div className="flex items-center justify-center border-2 border-black bg-[var(--giga-panel)] py-16 text-white/55">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading agent…
              </div>
            )}

            {data && (
              <>
                {/* Top row: identity + on-chain */}
                <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="border-2 border-black bg-[var(--giga-panel)] p-4 sm:col-span-2">
                    <div className="mb-1 text-xs uppercase tracking-wider text-white/55">
                      {data.manifest.category ?? 'general'} · {data.manifest.cost_credits ?? 8} credits
                    </div>
                    <h2 className="mb-2 font-pixel-header text-lg text-[var(--giga-accent)]">
                      {data.manifest.display_name ?? data.name}
                    </h2>
                    <p className="mb-3 text-sm leading-relaxed text-white/75">
                      {data.manifest.description ?? '—'}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(data.manifest.best_for_keywords ?? []).map((k) => (
                        <span
                          key={k}
                          className="border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-xs text-white/55"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="border-2 border-black bg-[var(--giga-panel)] p-4">
                    <div className="mb-2 text-xs uppercase tracking-wider text-white/55">
                      ERC-8004 identity
                    </div>
                    {data.agent_token_id ? (
                      <>
                        <div className="font-mono text-2xl text-emerald-300">
                          #{data.agent_token_id}
                        </div>
                        <div className="mt-2 space-y-1 text-xs">
                          {data.agent_tx_hash && (
                            <a
                              href={`${EXPLORER}/tx/${data.agent_tx_hash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-cyan-300 hover:text-cyan-200"
                            >
                              Mint tx <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {data.manifest.on_chain?.ipfs_uri && (
                            <a
                              href={`${PINATA_GATEWAY}${data.manifest.on_chain.ipfs_uri.replace('ipfs://', '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-cyan-300 hover:text-cyan-200"
                            >
                              IPFS metadata <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {data.manifest.on_chain?.owner && (
                            <div className="text-white/45">
                              Owner:{' '}
                              <span className="font-mono text-white/65">
                                {data.manifest.on_chain.owner.slice(0, 6)}…
                                {data.manifest.on_chain.owner.slice(-4)}
                              </span>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-white/45">Not minted yet</div>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Total dispatches" value={data.stats.total_dispatches} />
                  <Stat
                    label="Success rate"
                    value={
                      data.stats.success_rate !== null
                        ? `${(data.stats.success_rate * 100).toFixed(0)}%`
                        : '—'
                    }
                  />
                  <Stat label="Failed" value={data.stats.failed} tone={data.stats.failed > 0 ? 'red' : undefined} />
                  <Stat
                    label="Credits earned"
                    value={`${data.stats.total_credits_earned} cr`}
                    sub={`≈ $${(data.stats.total_credits_earned / 100).toFixed(2)}`}
                  />
                </div>

                {/* Try this agent */}
                <div className="mb-4 flex flex-col items-start gap-3 border-2 border-[var(--giga-accent)] bg-[var(--giga-accent)]/[0.08] p-4 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <div className="font-pixel-header text-sm text-white">
                      ▶ Try this agent
                    </div>
                    <div className="text-xs text-white/55">
                      {template
                        ? `Open the "${template.title}" template with the form pre-filled`
                        : 'Go back home to write a prompt using this skill'}
                    </div>
                  </div>
                  <button
                    onClick={tryAgent}
                    className="inline-flex items-center gap-1.5 border-2 border-black bg-[var(--giga-accent)] px-4 py-2 text-sm font-bold text-black hover:bg-yellow-300"
                  >
                    {template ? 'Open form' : 'Go home'} <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Input schema preview */}
                {data.manifest.input_schema?.properties && (
                  <div className="mb-4 border-2 border-black bg-[var(--giga-panel)] p-4">
                    <div className="mb-2 text-xs uppercase tracking-wider text-white/55">
                      Input schema
                    </div>
                    <div className="space-y-1 text-xs">
                      {Object.entries(data.manifest.input_schema.properties).map(([k, p]) => (
                        <div key={k} className="flex flex-wrap items-baseline gap-2">
                          <span className="font-mono text-[var(--giga-accent)]">{k}</span>
                          <span className="text-white/45">: {p.type ?? 'string'}</span>
                          {p.description && (
                            <span className="text-white/55">— {p.description}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent dispatches */}
                <div className="border-2 border-black bg-[var(--giga-panel)]">
                  <div className="border-b-2 border-black bg-[var(--giga-sidebar)] px-4 py-2 text-xs uppercase tracking-wider text-white/65">
                    Recent dispatches
                  </div>
                  {data.recent_dispatches.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-white/45">
                      No dispatches yet.
                    </div>
                  ) : (
                    data.recent_dispatches.map((d, i, arr) => (
                      <div
                        key={d.messageId}
                        className={`flex items-center gap-3 px-4 py-3 text-sm ${
                          i < arr.length - 1 ? 'border-b border-white/10' : ''
                        }`}
                      >
                        <Link
                          href={`/workflow/${d.workflowId}`}
                          className="flex-1 truncate font-mono text-xs text-white/65 hover:text-white"
                        >
                          /workflow/{d.workflowId.slice(0, 8)}…
                        </Link>
                        {d.tx && (
                          <a
                            href={`${EXPLORER}/tx/${d.tx}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-xs text-cyan-300 hover:text-cyan-200"
                          >
                            {d.tx.slice(0, 8)}…<ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <span className="text-xs text-white/40">
                          {new Date(d.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'red'
}) {
  const valueCls = tone === 'red' ? 'text-red-300' : 'text-cyan-200'
  return (
    <div className="border-2 border-black bg-[var(--giga-panel)] p-3">
      <div className="text-xs uppercase tracking-wider text-white/55">{label}</div>
      <div className={`mt-0.5 font-mono text-xl ${valueCls}`}>{value}</div>
      {sub && <div className="text-xs text-white/40">{sub}</div>}
    </div>
  )
}
