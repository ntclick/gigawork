'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useLogin, useLogout, usePrivy } from '@privy-io/react-auth'
import { Plus, Search, X, Wallet, LogOut, MessageSquare, Activity, Briefcase, Image as ImageIcon, Globe, TrendingUp } from 'lucide-react'

import { useUI } from './UIShell'

type Workflow = {
  id: string
  prompt: string
  status: string
  createdAt: string
}

type Me = {
  id: string
  wallet: string
  credits: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function bucket(ts: string): 'today' | 'week' | 'month' | 'older' {
  const age = Date.now() - new Date(ts).getTime()
  if (age < DAY_MS) return 'today'
  if (age < 7 * DAY_MS) return 'week'
  if (age < 30 * DAY_MS) return 'month'
  return 'older'
}

const LABELS: Record<string, string> = {
  today: 'Today',
  week: 'Last 7 days',
  month: 'Last 30 days',
  older: 'Older',
}

function shortTitle(s: string) {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > 32 ? t.slice(0, 32) + '…' : t
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/**
 * Pick a category icon from the workflow prompt — quick keyword match so the
 * sidebar feels alive without an LLM round-trip.
 */
function iconFor(prompt: string) {
  const p = prompt.toLowerCase()
  if (/sentiment|twitter|reddit|x\.com/.test(p)) return Activity
  if (/portfolio|rebalanc|hedge/.test(p)) return Briefcase
  if (/nft|mint/.test(p)) return ImageIcon
  if (/scrap|crawl|web|news/.test(p)) return Globe
  if (/trade|buy|sell|signal|long|short/.test(p)) return TrendingUp
  return MessageSquare
}

const ACTIVE_STATUSES = new Set(['running', 'streaming', 'submitted'])

export function HistorySidebar() {
  const [items, setItems] = useState<Workflow[]>([])
  const [q, setQ] = useState('')
  const [me, setMe] = useState<Me | null>(null)
  const params = useParams<{ id?: string }>()
  const activeId = params?.id
  const { historyOpen, closeHistory } = useUI()
  const { ready, authenticated, user } = usePrivy()
  const { login } = useLogin()
  const { logout } = useLogout()

  // Fetch workflow list — refresh on drawer open + every 15s.
  useEffect(() => {
    if (!ready) return
    if (!authenticated) {
      setItems([])
      return
    }
    const refresh = () =>
      fetch('/api/workflows', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => setItems(j.workflows ?? []))
        .catch(() => {})
    refresh()
    const t = setInterval(refresh, 15000)
    const onBust = () => refresh()
    window.addEventListener('gw:credits-changed', onBust)
    return () => {
      clearInterval(t)
      window.removeEventListener('gw:credits-changed', onBust)
    }
  }, [])
  useEffect(() => {
    if (historyOpen && authenticated) {
      fetch('/api/workflows', { cache: 'no-store' }).then((r) => r.json()).then((j) => setItems(j.workflows ?? [])).catch(() => {})
    }
  }, [historyOpen, authenticated])

  // Fetch user balance
  useEffect(() => {
    const refresh = () => fetch('/api/me', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => {})
    refresh()
    const t = setInterval(refresh, 15000)
    window.addEventListener('gw:credits-changed', refresh)
    return () => {
      clearInterval(t)
      window.removeEventListener('gw:credits-changed', refresh)
    }
  }, [authenticated])

  const filtered = q.trim()
    ? items.filter((w) => w.prompt.toLowerCase().includes(q.toLowerCase()))
    : items

  const groups: Record<string, Workflow[]> = { today: [], week: [], month: [], older: [] }
  for (const w of filtered) groups[bucket(w.createdAt)]!.push(w)

  // ─── Inner content (shared between desktop aside + mobile drawer) ──────
  const inner = (
    <div className="giga-theme flex h-full flex-col bg-[var(--giga-sidebar)] text-[var(--giga-text)]">
      {/* Header — title only on desktop; X close on mobile */}
      <div className="flex items-center justify-between px-6 pt-5 pb-2 md:pt-6 md:pb-3">
        <Link href="/" onClick={closeHistory} className="flex-1">
          <h1 className="font-pixel-header text-3xl font-bold text-white text-center md:text-4xl">
            GigaWork
          </h1>
        </Link>
        <button
          onClick={(e) => {
            e.preventDefault()
            closeHistory()
          }}
          aria-label="Close"
          className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded text-white/55 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* + New Workflow */}
      <div className="px-6 pt-2 pb-4">
        <Link
          href="/"
          onClick={closeHistory}
          className="flex w-full items-center justify-center gap-2 border-2 border-white/20 bg-[var(--giga-panel)] py-2 px-4 text-white transition hover:bg-[var(--giga-accent)]"
        >
          <Plus className="h-4 w-4" />
          <span className="text-base">New Workflow</span>
        </Link>
      </div>

      {/* Search */}
      <div className="px-6 pb-3">
        <div className="flex items-center gap-2 border-2 border-white/10 bg-[var(--giga-dark)]/60 px-2 py-1.5">
          <Search className="h-3 w-3 text-white/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search workflows…"
            className="flex-1 bg-transparent text-sm text-white/90 outline-none placeholder:text-white/30"
          />
        </div>
      </div>

      {/* Workflow list */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3 text-base">
        {filtered.length === 0 && (
          <div className="px-3 pt-6 text-center text-sm text-white/35">
            No workflows yet.<br />
            <span className="text-xs">Type a task to get started →</span>
          </div>
        )}
        {(['today', 'week', 'month', 'older'] as const).map((k) => {
          const list = groups[k]
          if (!list || list.length === 0) return null
          return (
            <div key={k} className="mb-3">
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-white/35">
                {LABELS[k]}
              </div>
              <ul className="space-y-1">
                {list.map((w) => {
                  const Icon = iconFor(w.prompt)
                  const active = activeId === w.id
                  const running = ACTIVE_STATUSES.has(w.status)
                  return (
                    <li key={w.id}>
                      <Link
                        href={`/workflow/${w.id}`}
                        onClick={closeHistory}
                        className={[
                          'flex items-center gap-3 rounded p-2 cursor-pointer transition',
                          active
                            ? 'bg-[var(--giga-panel)]/60 border-l-4 border-[var(--giga-accent)] pl-1'
                            : 'border-l-4 border-transparent pl-1 hover:bg-white/5',
                        ].join(' ')}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-[var(--giga-dark)]/60 border border-white/10 text-white/70">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className={`flex-1 truncate text-sm leading-snug ${active ? 'text-white' : 'text-white/75'}`}>
                          {shortTitle(w.prompt)}
                        </span>
                        {running && <span className="text-green-400 text-sm">📈</span>}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* User profile footer */}
      <div className="border-t-2 border-[var(--giga-border-shadow, var(--giga-panel))] bg-[var(--giga-dark)]/60 p-4">
        {!ready ? (
          <div className="flex h-12 items-center text-xs text-white/40">Đang tải…</div>
        ) : !authenticated ? (
          <button
            onClick={() => login()}
            className="flex w-full items-center justify-center gap-2 border-2 border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-cyan-100 transition hover:bg-cyan-400/20"
          >
            <Wallet className="h-4 w-4" />
            <span>Kết nối ví</span>
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <div
              data-pixel
              className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border-2 border-indigo-400 bg-indigo-900"
              aria-hidden="true"
            >
              <svg height="40" viewBox="0 0 40 40" width="40" xmlns="http://www.w3.org/2000/svg">
                <rect fill="#3a3a5e" height="4" width="20" x="10" y="16"></rect>
                <rect fill="#3a3a5e" height="4" width="12" x="14" y="12"></rect>
                <rect fill="#3a3a5e" height="4" width="8" x="16" y="8"></rect>
                <rect fill="#3a3a5e" height="4" width="4" x="18" y="4"></rect>
                <rect fill="#fcdbb6" height="8" width="12" x="14" y="20"></rect>
                <rect fill="#000" height="2" width="2" x="16" y="22"></rect>
                <rect fill="#000" height="2" width="2" x="22" y="22"></rect>
                <rect fill="#fff" height="8" width="16" x="12" y="28"></rect>
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base text-white">
                {user?.email?.address ?? (user?.wallet?.address ? shortAddr(user.wallet.address) : 'Adventurer')}
              </div>
              <div className="mt-0.5 inline-flex items-center gap-1 border border-[#3b82f6] bg-[#1e3a8a] px-2 text-white">
                <span className="text-[#60a5fa]">($)</span>
                <span className="text-xs">
                  {(me?.credits ?? 0).toLocaleString()} cr
                </span>
              </div>
            </div>
            <button
              onClick={() => logout()}
              title="Log out"
              className="ml-1 inline-flex h-7 w-7 items-center justify-center text-white/40 hover:text-red-300"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop: static aside */}
      <aside className="hidden h-full w-64 shrink-0 flex-col border-r-2 border-[var(--giga-panel)] md:flex">
        {inner}
      </aside>

      {/* Mobile: slide-in drawer */}
      {historyOpen && (
        <>
          <div className="gw-drawer-backdrop md:hidden" onClick={closeHistory} role="presentation" />
          <aside
            className="gw-drawer-panel gw-drawer-left md:hidden"
            role="dialog"
            aria-label="Lịch sử workflow"
          >
            {inner}
          </aside>
        </>
      )}
    </>
  )
}
