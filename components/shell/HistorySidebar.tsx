'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useLogin, useLogout, usePrivy } from '@privy-io/react-auth'
import { Plus, Search, X, Wallet, LogOut } from 'lucide-react'

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

const STATUS_DOT: Record<string, string> = {
  running: 'bg-cyan-400 animate-pulse',
  streaming: 'bg-cyan-400 animate-pulse',
  submitted: 'bg-cyan-400 animate-pulse',
  completed: 'bg-emerald-400',
  failed: 'bg-red-500',
  settling: 'bg-amber-400 animate-pulse',
}

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

  useEffect(() => {
    if (!ready) return
    if (!authenticated) {
      setTimeout(() => { setItems([]) }, 0)
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
  }, [ready, authenticated])

  useEffect(() => {
    if (historyOpen && authenticated) {
      fetch('/api/workflows', { cache: 'no-store' }).then((r) => r.json()).then((j) => setItems(j.workflows ?? [])).catch(() => {})
    }
  }, [historyOpen, authenticated])

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

  const inner = (
    <div className="flex h-full flex-col bg-[#0c0e14]" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <Link href="/" onClick={closeHistory}>
          <span className="text-sm font-semibold tracking-tight text-white">
            Giga<span className="gw-gradient-text">Work</span>
          </span>
        </Link>
        <button
          onClick={(e) => { e.preventDefault(); closeHistory() }}
          aria-label="Close"
          className="md:hidden inline-flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/8 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* New Workflow */}
      <div className="px-3 pb-3">
        <Link
          href="/"
          onClick={closeHistory}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500/15 to-violet-500/10 border border-cyan-500/20 py-2 px-3 text-xs font-medium text-cyan-300 transition hover:border-cyan-500/35 hover:from-cyan-500/20 hover:to-violet-500/15"
        >
          <Plus className="h-3.5 w-3.5" />
          New Workflow
        </Link>
      </div>

      {/* Search */}
      <div className="px-3 pb-3">
        <div className="gw-input flex items-center gap-2 px-2.5 py-1.5">
          <Search className="h-3 w-3 shrink-0 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="flex-1 bg-transparent text-xs text-white/85 outline-none placeholder:text-white/25"
          />
        </div>
      </div>

      {/* Workflow list */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 && (
          <div className="px-3 pt-8 text-center text-xs text-white/25">
            No workflows yet.
          </div>
        )}
        {(['today', 'week', 'month', 'older'] as const).map((k) => {
          const list = groups[k]
          if (!list || list.length === 0) return null
          return (
            <div key={k} className="mb-2">
              <div className="px-2 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-widest text-white/25">
                {LABELS[k]}
              </div>
              <ul className="space-y-0.5">
                {list.map((w) => {
                  const active = activeId === w.id
                  const dotClass = STATUS_DOT[w.status] ?? 'bg-white/20'
                  return (
                    <li key={w.id}>
                      <Link
                        href={`/workflow/${w.id}`}
                        onClick={closeHistory}
                        className={[
                          'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition',
                          active
                            ? 'bg-white/8 text-white'
                            : 'text-white/55 hover:bg-white/5 hover:text-white/85',
                        ].join(' ')}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
                        <span className="flex-1 truncate text-xs leading-relaxed">
                          {shortTitle(w.prompt)}
                        </span>
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
      <div className="border-t border-white/[0.05] p-3">
        {!ready ? (
          <div className="flex h-10 items-center text-xs text-white/25">Loading…</div>
        ) : !authenticated ? (
          <button
            onClick={() => login()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/8 px-3 py-2 text-xs text-cyan-300 transition hover:bg-cyan-400/15"
          >
            <Wallet className="h-3.5 w-3.5" />
            Connect wallet
          </button>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500/40 to-cyan-500/30 border border-white/10">
              <svg height="28" viewBox="0 0 40 40" width="28">
                <rect fill="#3a3a5e" height="4" width="20" x="10" y="16" />
                <rect fill="#3a3a5e" height="4" width="12" x="14" y="12" />
                <rect fill="#3a3a5e" height="4" width="8" x="16" y="8" />
                <rect fill="#3a3a5e" height="4" width="4" x="18" y="4" />
                <rect fill="#fcdbb6" height="8" width="12" x="14" y="20" />
                <rect fill="#000" height="2" width="2" x="16" y="22" />
                <rect fill="#000" height="2" width="2" x="22" y="22" />
                <rect fill="#fff" height="8" width="16" x="12" y="28" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-white/80">
                {user?.email?.address ?? (user?.wallet?.address ? shortAddr(user.wallet.address) : 'Adventurer')}
              </div>
              <div className="mt-0.5 text-[10px] text-white/35">
                {(me?.credits ?? 0).toLocaleString()} credits
              </div>
            </div>
            <button
              onClick={() => logout()}
              title="Log out"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-white/25 transition hover:bg-red-500/10 hover:text-red-400"
            >
              <LogOut className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop: static aside */}
      {historyOpen && (
        <aside className="hidden h-full w-60 shrink-0 flex-col md:flex">
          {inner}
        </aside>
      )}

      {/* Mobile: slide-in drawer */}
      {historyOpen && (
        <>
          <div className="gw-drawer-backdrop md:hidden" onClick={closeHistory} role="presentation" />
          <aside
            className="gw-drawer-panel gw-drawer-left flex flex-col md:hidden"
            role="dialog"
            aria-label="Workflow history"
          >
            {inner}
          </aside>
        </>
      )}
    </>
  )
}
