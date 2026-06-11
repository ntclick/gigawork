'use client'

/**
 * /agents — list of all registered ERC-8004 skills with metadata + on-chain badge.
 */
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Plus, Search } from 'lucide-react'

import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'
import { useSkills, type Skill } from '@/lib/hooks/useSkills'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  research:     { label: 'Research',     color: 'text-cyan-300 bg-cyan-400/10 border-cyan-400/20' },
  'on-chain':   { label: 'On-chain',     color: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20' },
  execution:    { label: 'Execution',    color: 'text-amber-300 bg-amber-400/10 border-amber-400/20' },
  analysis:     { label: 'Analysis',     color: 'text-violet-300 bg-violet-400/10 border-violet-400/20' },
  synthesis:    { label: 'Synthesis',    color: 'text-blue-300 bg-blue-400/10 border-blue-400/20' },
  notification: { label: 'Notification', color: 'text-pink-300 bg-pink-400/10 border-pink-400/20' },
  general:      { label: 'General',      color: 'text-white/50 bg-white/5 border-white/10' },
}

function categoryOf(s: Skill): string {
  return (s.manifest.category as string) ?? 'general'
}

export default function AgentsPage() {
  const { skills, loading } = useSkills()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('all')

  const cats = useMemo(() => {
    const set = new Set(skills.map(categoryOf))
    return Array.from(set).sort()
  }, [skills])

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim()
    return skills.filter((s) => {
      if (cat !== 'all' && categoryOf(s) !== cat) return false
      if (!ql) return true
      const m = s.manifest
      const hay = [s.name, m.display_name, m.description, ...(m.best_for_keywords ?? [])]
        .filter(Boolean).join(' ').toLowerCase()
      return hay.includes(ql)
    })
  }, [skills, q, cat])

  return (
    <>
      <MainHeader />
      <div className="giga-theme gw-main-shell">
        <AppRail />
        <HistorySidebar />
        <main className="flex-1 overflow-y-auto bg-[var(--gw-bg)] p-5 sm:p-8">
          <div className="mx-auto w-full max-w-5xl">

            {/* Header */}
            <div className="mb-6 flex items-center gap-3">
              <Link
                href="/"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/50 transition hover:bg-white/[0.08] hover:text-white"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-white">Agents</h1>
                <p className="text-xs text-white/35">ERC-8004 registry · {skills.length} registered</p>
              </div>
              <Link
                href="/providers/register"
                className="ml-auto gw-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Register
              </Link>
            </div>

            {/* Search + filters */}
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="gw-input flex flex-1 items-center gap-2 px-3 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-white/30" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search agents…"
                  className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <FilterChip label={`All`} count={skills.length} active={cat === 'all'} onClick={() => setCat('all')} />
                {cats.map((c) => (
                  <FilterChip
                    key={c}
                    label={CATEGORY_META[c]?.label ?? c}
                    active={cat === c}
                    onClick={() => setCat(c)}
                  />
                ))}
              </div>
            </div>

            {/* Grid */}
            {loading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="gw-skeleton h-44 rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-16 text-center text-sm text-white/30">
                No agents match your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((s) => (
                  <AgentCard key={s.id} skill={s} />
                ))}
              </div>
            )}

            <p className="mt-6 text-xs text-white/25">
              Each agent is an ERC-8004 NFT on Arc Testnet. Owner earns{' '}
              <span className="font-mono text-white/40">0.08 USDC</span> per dispatch.
            </p>
          </div>
        </main>
      </div>
    </>
  )
}

function FilterChip({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-lg border px-3 py-1 text-xs font-medium transition',
        active
          ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300'
          : 'border-white/[0.07] bg-white/[0.03] text-white/40 hover:border-white/15 hover:text-white/70',
      ].join(' ')}
    >
      {label}{count !== undefined && <span className="ml-1 opacity-50">{count}</span>}
    </button>
  )
}

function AgentCard({ skill }: { skill: Skill }) {
  const m = skill.manifest
  const cat = categoryOf(skill)
  const meta = CATEGORY_META[cat] ?? CATEGORY_META.general
  const cost = (m.cost_credits as number) ?? 8
  const minted = !!skill.agentTokenId

  return (
    <Link
      href={`/agents/${skill.name}`}
      className="gw-glass-card group flex flex-col p-4 no-underline"
    >
      {/* Top row */}
      <div className="mb-3 flex items-start justify-between">
        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.color}`}>
          {meta.label}
        </span>
        <div className="flex items-center gap-1.5">
          {/* Liveness badge */}
          {minted && (
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold border ${
                skill.livenessStatus === 'ACTIVE'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : skill.livenessStatus === 'DEGRADED'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                  : 'bg-white/5 text-white/30 border-white/10'
              }`}
            >
              <span className={`h-1 w-1 rounded-full ${
                skill.livenessStatus === 'ACTIVE' ? 'bg-emerald-400 animate-pulse' :
                skill.livenessStatus === 'DEGRADED' ? 'bg-amber-400 animate-pulse' :
                'bg-white/25'
              }`} />
              {skill.livenessStatus ?? 'OFFLINE'}
            </span>
          )}
          <span className="rounded border border-cyan-400/20 bg-cyan-400/8 px-1.5 py-0.5 font-mono text-[10px] text-cyan-400">
            {cost} cr
          </span>
        </div>
      </div>

      {/* Content */}
      <h3 className="mb-1 text-sm font-semibold text-white">
        {m.display_name ?? skill.name}
      </h3>
      <p className="mb-4 line-clamp-2 flex-1 text-xs leading-relaxed text-white/40">
        {m.description ?? 'No description.'}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/[0.05] pt-3 text-xs">
        <span className="font-mono text-white/30">{skill.name}</span>
        {minted ? (
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              window.open(`${EXPLORER}/tx/${skill.agentTxHash}`, '_blank')
            }}
            className="inline-flex items-center gap-1 text-emerald-400/70 transition hover:text-emerald-300"
          >
            #{skill.agentTokenId} <ExternalLink className="h-3 w-3" />
          </button>
        ) : (
          <span className="text-white/20">unminted</span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-1 text-[10px] text-cyan-400/60 opacity-0 transition-opacity group-hover:opacity-100">
        View details <ArrowRight className="h-3 w-3" />
      </div>
    </Link>
  )
}
