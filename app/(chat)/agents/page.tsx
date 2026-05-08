'use client'

/**
 * /agents — list of all registered ERC-8004 skills with metadata + on-chain badge.
 */
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Search } from 'lucide-react'

import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'
import { useSkills, type Skill } from '@/lib/hooks/useSkills'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

const CATEGORY_LABEL: Record<string, { label: string; emoji: string }> = {
  research: { label: 'Research', emoji: '🔬' },
  'on-chain': { label: 'On-chain', emoji: '⛓' },
  execution: { label: 'Execution', emoji: '⚡' },
  analysis: { label: 'Analysis', emoji: '📈' },
  synthesis: { label: 'Synthesis', emoji: '📝' },
  notification: { label: 'Notification', emoji: '📨' },
  general: { label: 'General', emoji: '◆' },
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
      const hay = [
        s.name,
        m.display_name,
        m.description,
        ...(m.best_for_keywords ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(ql)
    })
  }, [skills, q, cat])

  return (
    <div className="giga-theme flex h-full w-full flex-col">
      <MainHeader />
      <div className="flex flex-1 overflow-hidden">
        <HistorySidebar />
        <AppRail />
        <main className="flex-1 overflow-y-auto bg-[#0f131c] p-4 sm:p-8">
          <div className="mx-auto w-full max-w-5xl">
            {/* Header */}
            <div className="mb-6 flex items-center gap-3">
              <Link
                href="/"
                className="inline-flex h-8 w-8 items-center justify-center border-2 border-black bg-[var(--giga-panel)] text-white/70 hover:text-white"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <h1 className="font-pixel-header text-xl text-white sm:text-2xl">
                Agents · ERC-8004 registry
              </h1>
            </div>

            {/* Filters */}
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-2 border-2 border-black bg-[var(--giga-panel)] px-3 py-2">
                <Search className="h-3.5 w-3.5 text-white/45" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name, description, keyword…"
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                <FilterChip label={`All (${skills.length})`} active={cat === 'all'} onClick={() => setCat('all')} />
                {cats.map((c) => (
                  <FilterChip
                    key={c}
                    label={`${CATEGORY_LABEL[c]?.emoji ?? '◆'} ${CATEGORY_LABEL[c]?.label ?? c}`}
                    active={cat === c}
                    onClick={() => setCat(c)}
                  />
                ))}
              </div>
            </div>

            {/* Grid */}
            {loading ? (
              <div className="border-2 border-black bg-[var(--giga-panel)] py-16 text-center text-white/55">
                Loading agents…
              </div>
            ) : filtered.length === 0 ? (
              <div className="border-2 border-black bg-[var(--giga-panel)] py-12 text-center text-white/55">
                No agents match "{q}" in category "{cat}".
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((s) => (
                  <AgentCard key={s.id} skill={s} />
                ))}
              </div>
            )}

            <p className="mt-6 text-xs text-white/40">
              Each agent is an ERC-8004 NFT on Arc Testnet. The owner earns{' '}
              <span className="font-mono">0.08 USDC</span> per dispatch.
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`border-2 border-black px-3 py-1 text-xs uppercase tracking-wider transition ${
        active ? 'bg-[var(--giga-accent)] text-black' : 'bg-[#1f1f33] text-white/65 hover:bg-[#27273f]'
      }`}
    >
      {label}
    </button>
  )
}

function AgentCard({ skill }: { skill: Skill }) {
  const m = skill.manifest
  const cat = categoryOf(skill)
  const decor = CATEGORY_LABEL[cat] ?? CATEGORY_LABEL.general
  const cost = (m.cost_credits as number) ?? 8
  const minted = !!skill.agentTokenId

  return (
    <Link
      href={`/agents/${skill.name}`}
      className="group flex flex-col border-2 border-black bg-[var(--giga-panel)] transition hover:bg-[#2c294e]"
    >
      {/* Header banner */}
      <div className="flex items-center gap-2 border-b-2 border-black bg-[var(--giga-sidebar)] px-3 py-2">
        <span className="text-base">{decor.emoji}</span>
        <span className="text-xs uppercase tracking-wider text-white/65">
          {decor.label}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span className="border border-[var(--giga-accent)]/40 bg-[var(--giga-accent)]/10 px-1.5 py-px font-mono text-[11px] text-[var(--giga-accent)]">
            {cost} cr
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h3 className="mb-1 text-sm font-bold text-white">
          {m.display_name ?? skill.name}
        </h3>
        <p className="mb-3 line-clamp-2 text-xs text-white/55">
          {m.description ?? 'No description.'}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs">
          <span className="font-mono text-white/45">{skill.name}</span>
          {minted ? (
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                window.open(`${EXPLORER}/tx/${skill.agentTxHash}`, '_blank')
              }}
              className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
            >
              8004 #{skill.agentTokenId} <ExternalLink className="h-3 w-3" />
            </button>
          ) : (
            <span className="text-white/35">unminted</span>
          )}
        </div>

        <div className="mt-2 flex items-center justify-end gap-1 text-xs text-[var(--giga-accent)] opacity-0 transition group-hover:opacity-100">
          View details <ArrowRight className="h-3 w-3" />
        </div>
      </div>
    </Link>
  )
}
