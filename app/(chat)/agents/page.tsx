'use client'

/**
 * /agents — list of all registered ERC-8004 skills with metadata + on-chain badge.
 */
import Link from 'next/link'
import { useMemo, useState, useEffect, useCallback } from 'react'
import { ArrowLeft, ExternalLink, Plus, Search, Copy, Check, ShieldAlert, X, HelpCircle } from 'lucide-react'

import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { toast } from '@/components/ui/toast'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e"

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  research:     { label: 'Research',     color: 'text-cyan-300 bg-cyan-400/10 border-cyan-400/20' },
  'on-chain':   { label: 'On-chain',     color: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20' },
  execution:    { label: 'Execution',    color: 'text-amber-300 bg-amber-400/10 border-amber-400/20' },
  analysis:     { label: 'Analysis',     color: 'text-violet-300 bg-violet-400/10 border-violet-400/20' },
  synthesis:    { label: 'Synthesis',    color: 'text-blue-300 bg-blue-400/10 border-blue-400/20' },
  notification: { label: 'Notification', color: 'text-pink-300 bg-pink-400/10 border-pink-400/20' },
  general:      { label: 'General',      color: 'text-white/50 bg-white/5 border-white/10' },
}

interface AgentManifest {
  description?: string
  best_for_keywords?: string[]
  disabled?: boolean
  price_override?: string
}

interface Agent {
  address: string
  name: string
  slug: string
  category: string
  pricePerCall: string
  reputation: number | null
  status: 'online' | 'busy' | 'offline' | 'unknown'
  totalEarnings: string
  totalCalls: number
  source: 'on-chain' | 'cache' | 'fallback'
  manifest?: AgentManifest
  agentTokenId?: string | null
  agentTxHash?: string | null
}

export default function AgentsPage() {
  const activeWallet = useActiveWallet()
  const isAdmin = activeWallet?.address?.toLowerCase() === '0xafe6dd950dc2cf561e8daba1725e0e6840f70549'

  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'reputation' | 'price' | 'newest'>('reputation')
  const [modalOpen, setModalOpen] = useState(false)
  const [copiedRegistry, setCopiedRegistry] = useState(false)

  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const onRefresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1)
  }, [])

  useEffect(() => {
    let active = true
    const loadAgents = async () => {
      try {
        const res = await fetch('/api/skills', { cache: 'no-store' })
        const data = await res.json()
        if (res.ok && active) {
          setAgents(data.skills ?? [])
        }
      } catch (err) {
        console.error('Failed to load agents:', err)
        toast.error('Load error', 'Failed to fetch agent list from the registry.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadAgents()
    return () => {
      active = false
    }
  }, [refreshTrigger])

  const cats = useMemo(() => {
    const set = new Set(agents.map((a) => a.category))
    return Array.from(set).sort()
  }, [agents])

  const sortedAndFiltered = useMemo(() => {
    const ql = q.toLowerCase().trim()
    let res = agents.filter((s) => {
      if (cat !== 'all' && s.category !== cat) return false
      if (!ql) return true
      const m = s.manifest
      const hay = [s.name, s.slug, m?.description, ...(m?.best_for_keywords ?? [])]
        .filter(Boolean).join(' ').toLowerCase()
      return hay.includes(ql)
    })

    res = [...res].sort((a, b) => {
      if (sortBy === 'reputation') {
        const repA = a.reputation ?? 0
        const repB = b.reputation ?? 0
        return repB - repA
      }
      if (sortBy === 'price') {
        return parseFloat(a.pricePerCall) - parseFloat(b.pricePerCall)
      }
      if (sortBy === 'newest') {
        const idA = parseInt(a.agentTokenId || '0')
        const idB = parseInt(b.agentTokenId || '0')
        return idB - idA
      }
      return 0
    })

    return res
  }, [agents, q, cat, sortBy])

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr)
    toast.success('Address copied', 'Registry address copied to clipboard.')
    setCopiedRegistry(true)
    setTimeout(() => setCopiedRegistry(false), 2000)
  }

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
                <h1 className="text-lg font-semibold text-white">Agent Directory</h1>
                <p className="text-xs text-white/35">ERC-8004 registry · {agents.length} registered</p>
              </div>
              <button
                onClick={() => setModalOpen(true)}
                className="ml-auto gw-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                Register Agent
              </button>
            </div>

            {/* Search + filters + Sort */}
            <div className="mb-5 flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="gw-input flex flex-1 items-center gap-2 px-3 py-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-white/30" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search agents by name or capabilities…"
                    className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"
                  />
                </div>
                
                {/* Sort selector */}
                <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] p-0.5 self-start sm:self-auto">
                  {(['reputation', 'price', 'newest'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSortBy(mode)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                        sortBy === mode
                          ? 'bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                          : 'text-white/40 hover:text-white/70'
                      }`}
                    >
                      {mode === 'reputation' ? 'Highest Reputation' : mode === 'price' ? 'Lowest Price' : 'Newest'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category Chips */}
              <div className="flex flex-wrap gap-1.5">
                <FilterChip label={`All`} count={agents.length} active={cat === 'all'} onClick={() => setCat('all')} />
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="gw-skeleton h-56 rounded-xl" />
                ))}
              </div>
            ) : sortedAndFiltered.length === 0 ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-16 text-center text-sm text-white/30">
                No agents match your criteria.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sortedAndFiltered.map((agent) => (
                  <AgentCard 
                    key={agent.slug} 
                    agent={agent} 
                    isAdmin={isAdmin}
                    adminWalletAddress={activeWallet?.address}
                    onRefresh={onRefresh}
                  />
                ))}
              </div>
            )}

            <p className="mt-6 text-xs text-white/25">
              Each agent is registered as an ERC-8004 NFT identity on Arc Testnet. Settings can be updated in DB cache by ecosystem administrators.
            </p>
          </div>
        </main>
      </div>

      {/* Registration Guide Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-[500px] max-w-full rounded-2xl border border-white/10 bg-[#0f131c] p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-md font-bold text-white flex items-center gap-2">
                <HelpCircle className="h-5 w-5 text-cyan-400" />
                <span>Register AI Agent Provider (ERC-8004)</span>
              </h3>
              <button 
                onClick={() => setModalOpen(false)} 
                className="text-white/40 hover:text-white/80 p-1.5 rounded-lg hover:bg-white/5 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-white/70 leading-relaxed">
              <p>To register your independent agent provider in the GigaWork marketplace, follow these steps:</p>
              
              <ol className="list-decimal list-inside space-y-3 pl-1">
                <li>
                  Call the <code className="text-cyan-400 font-mono bg-white/5 px-1 py-0.5 rounded">register(string agentURI)</code> function on the ERC-8004 Identity Registry contract:
                  <div className="mt-2 flex items-center justify-between gap-2 bg-white/5 p-2.5 rounded-lg border border-white/5 font-mono text-[10px] text-white">
                    <span className="truncate">{IDENTITY_REGISTRY}</span>
                    <button 
                      onClick={() => copyAddress(IDENTITY_REGISTRY)}
                      className="p-1.5 rounded bg-white/10 hover:bg-white/20 transition flex items-center gap-1 shrink-0"
                    >
                      {copiedRegistry ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      <span>Copy</span>
                    </button>
                  </div>
                </li>
                <li>
                  Provide an <code className="text-cyan-400 font-mono bg-white/5 px-1 py-0.5 rounded">agentURI</code> resolving to a JSON metadata containing name, category, and HTTPS skill endpoint URL.
                </li>
                <li>
                  Once verified on-chain, GigaWork will automatically discover your agent. DB settings (routing status, overrides) can be managed via the admin dashboard.
                </li>
              </ol>
            </div>

            <div className="flex justify-end border-t border-white/5 pt-4">
              <button 
                onClick={() => setModalOpen(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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

function AgentCard({ 
  agent, 
  isAdmin, 
  adminWalletAddress,
  onRefresh 
}: { 
  agent: Agent 
  isAdmin: boolean
  adminWalletAddress?: string
  onRefresh: () => void
}) {
  const m = agent.manifest ?? {}
  const cat = agent.category
  const meta = CATEGORY_META[cat] ?? CATEGORY_META.general
  const minted = !!agent.agentTokenId

  const [savingAdmin, setSavingAdmin] = useState(false)
  const [overridePriceVal, setOverridePriceVal] = useState(m.price_override ?? '')

  const handleToggleDisabled = async () => {
    if (savingAdmin) return
    setSavingAdmin(true)
    try {
      const currentlyDisabled = m.disabled === true
      const res = await fetch(`/api/skills/${agent.slug}/admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-address': adminWalletAddress ?? '',
        },
        body: JSON.stringify({ disabled: !currentlyDisabled }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success(currentlyDisabled ? 'Agent Enabled' : 'Agent Disabled', 'Agent routing settings updated successfully.')
      onRefresh()
    } catch (err) {
      console.error(err)
      toast.error('Update failed', 'Failed to toggle agent routing status.')
    } finally {
      setSavingAdmin(false)
    }
  }

  const handleSavePriceOverride = async () => {
    if (savingAdmin) return
    setSavingAdmin(true)
    try {
      const res = await fetch(`/api/skills/${agent.slug}/admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-address': adminWalletAddress ?? '',
        },
        body: JSON.stringify({ priceOverride: overridePriceVal || null }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success('Price Updated', 'Agent price override updated successfully.')
      onRefresh()
    } catch (err) {
      console.error(err)
      toast.error('Update failed', 'Failed to update price override.')
    } finally {
      setSavingAdmin(false)
    }
  }

  // Display stars
  const reputationStars = useMemo(() => {
    if (agent.reputation == null) return null
    return (agent.reputation / 20).toFixed(1)
  }, [agent.reputation])

  return (
    <div className="gw-glass-card group flex flex-col p-4 no-underline relative">
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
                agent.status === 'online'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : agent.status === 'busy'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                  : 'bg-white/5 text-white/30 border-white/10'
              }`}
            >
              <span className={`h-1 w-1 rounded-full ${
                agent.status === 'online' ? 'bg-emerald-400 animate-pulse' :
                agent.status === 'busy' ? 'bg-amber-400 animate-pulse' :
                'bg-white/25'
              }`} />
              {agent.status.toUpperCase()}
            </span>
          )}
          <span className="rounded border border-cyan-400/20 bg-cyan-400/8 px-1.5 py-0.5 font-mono text-[10px] text-cyan-400">
            {agent.pricePerCall} USDC
          </span>
        </div>
      </div>

      {/* Content */}
      <h3 className="mb-1 text-sm font-semibold text-white">
        {agent.name}
      </h3>
      <p className="mb-3 line-clamp-2 flex-1 text-xs leading-relaxed text-white/40">
        {m.description ?? 'No description.'}
      </p>

      {/* Roster-style Mini Stats */}
      <div className="mb-4 flex items-center justify-between text-[11px] border-t border-b border-white/[0.04] py-2">
        <span className="text-white/45 font-mono">{agent.totalCalls} calls</span>
        {reputationStars ? (
          <span className="text-amber-400 font-semibold">{reputationStars}★ reputation</span>
        ) : (
          <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-bold text-cyan-400">NEW</span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/[0.05] pt-3 text-[11px]">
        <span className="font-mono text-white/30 truncate max-w-[120px]">{agent.slug}</span>
        {minted ? (
          <button
            onClick={() => window.open(`${EXPLORER}/tx/${agent.agentTxHash}`, '_blank')}
            className="inline-flex items-center gap-1 text-emerald-400/70 transition hover:text-emerald-300 text-xs"
          >
            #{agent.agentTokenId} <ExternalLink className="h-3 w-3" />
          </button>
        ) : (
          <span className="text-white/20">unminted</span>
        )}
      </div>

      {/* Admin actions block */}
      {isAdmin && (
        <div className="mt-4 border-t border-dashed border-white/10 pt-3 space-y-2.5">
          <div className="flex items-center justify-between text-xs text-white/60">
            <span className="flex items-center gap-1 font-bold text-rose-400/80">
              <ShieldAlert className="h-3.5 w-3.5" /> Admin Settings
            </span>
            <button
              onClick={handleToggleDisabled}
              disabled={savingAdmin}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                m.disabled === true
                  ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                  : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
              }`}
            >
              {savingAdmin ? '...' : m.disabled === true ? 'Enable' : 'Disable'}
            </button>
          </div>
          
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="Override price (USDC)"
              value={overridePriceVal}
              onChange={(e) => setOverridePriceVal(e.target.value)}
              className="flex-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white focus:outline-none"
            />
            <button
              onClick={handleSavePriceOverride}
              disabled={savingAdmin}
              className="rounded bg-white/10 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
