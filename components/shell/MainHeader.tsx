'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useLogin, useLogout, usePrivy, useWallets } from '@privy-io/react-auth'
import { Coins, LogOut, Menu, Wallet, X } from 'lucide-react'

import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { useUI } from './UIShell'

const ARC_NETWORK_LABEL =
  process.env.NEXT_PUBLIC_ARC_NETWORK_LABEL ?? 'Arc Testnet'
const ARC_EXPLORER =
  process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

interface NavItem {
  label: string
  href: string
  match?: (p: string) => boolean
  external?: boolean
}

const NAV: NavItem[] = [
  { label: 'Home', href: '/', match: (p: string) => p === '/' },
  { label: 'Workflows', href: '/', match: (p: string) => p.startsWith('/workflow') },
  { label: 'Signals 📈', href: '/signals', match: (p: string) => p.startsWith('/signals') },
  { label: 'Agents', href: '/agents' },
  { label: 'Raffle', href: '/raffle', match: (p: string) => p.startsWith('/raffle') },
  { label: 'Docs', href: '/docs' },
  { label: 'Finance', href: '/finance' },
  { label: 'Faucet', href: 'https://faucet.circle.com/', external: true },
  { label: 'Profile', href: '/profile' },
  { label: 'Settings', href: '/settings' },
]

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export function MainHeader() {
  const pathname = usePathname() ?? '/'
  const { ready, authenticated, user } = usePrivy()
  const { wallets } = useWallets()
  const { login } = useLogin()
  const { logout } = useLogout()
  const { toggleHistory } = useUI()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const walletAddr =
    user?.wallet?.address?.toLowerCase() ??
    wallets[0]?.address?.toLowerCase() ??
    null
  const wallet = walletAddr ?? null
  const usdc = useUSDCBalance(wallet)

  const isAdmin = walletAddr === '0xafe6dd950dc2cf561e8daba1725e0e6840f70549'
  const activeNav = [
    ...NAV,
    ...(isAdmin ? [{ label: 'Admin', href: '/admin' }] : []),
  ]

  const syncedAddrRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ready) return
    if (walletAddr && walletAddr !== syncedAddrRef.current) {
      const target = walletAddr
      syncedAddrRef.current = target
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: target }),
        credentials: 'same-origin',
      })
        .then((r) => {
          if (!r.ok) {
            if (syncedAddrRef.current === target) syncedAddrRef.current = null
            return
          }
          window.dispatchEvent(new CustomEvent('gw:credits-changed'))
        })
        .catch(() => {
          if (syncedAddrRef.current === target) syncedAddrRef.current = null
        })
    }
    if (!authenticated && syncedAddrRef.current) {
      syncedAddrRef.current = null
      fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    }
  }, [ready, authenticated, walletAddr])

  const [credits, setCredits] = useState<number | null>(null)
  useEffect(() => {
    const refresh = () =>
      fetch('/api/me', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setCredits(j.credits ?? 0))
        .catch(() => {})
    refresh()
    const t = setInterval(refresh, 15000)
    const onBust = () => refresh()
    window.addEventListener('gw:credits-changed', onBust)
    return () => {
      clearInterval(t)
      window.removeEventListener('gw:credits-changed', onBust)
    }
  }, [authenticated])

  return (
    <header className="giga-theme z-20 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] bg-black/60 px-3 backdrop-blur-xl sm:px-5">
      {/* Left: logo + nav */}
      <div className="flex min-w-0 items-center gap-4 sm:gap-6">
        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
          className="lg:hidden inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/8 hover:text-white"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>

        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2 group">
          <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 shadow-[0_0_16px_rgba(34,211,238,0.35)]">
            <span className="text-xs font-black text-black">G</span>
          </div>
          <span className="hidden font-semibold tracking-tight text-white sm:block">
            Giga<span className="gw-gradient-text">Work</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-0.5 lg:flex">
          {activeNav.map((it: NavItem) => {
            const isActive = it.match ? it.match(pathname) : pathname.startsWith(it.href)
            if (it.external) {
              return (
                <a
                  key={it.label}
                  href={it.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md px-3 py-1.5 text-sm text-white/50 transition hover:bg-white/6 hover:text-white"
                >
                  {it.label}
                </a>
              )
            }
            return (
              <Link
                key={it.label}
                href={it.href}
                className={[
                  'rounded-md px-3 py-1.5 text-sm transition',
                  isActive
                    ? 'bg-white/8 text-white font-medium'
                    : 'text-white/50 hover:bg-white/6 hover:text-white',
                ].join(' ')}
              >
                {it.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Right: ARC badge + wallet + credits + profile */}
      <div className="flex items-center gap-2">
        {/* Unified Finance Balance Pill */}
        {ready && authenticated && wallet && (
          <Link
            href="/finance"
            className="flex items-center gap-2 rounded-full border border-cyan-500/20 bg-[#0d101a] px-3 py-1 text-xs text-white transition hover:border-cyan-400/40 shadow-sm"
            title={`USDC Balance: ${usdc.formatted} | Credits: ${credits?.toLocaleString() ?? 0} cr`}
          >
            <span className="flex items-center gap-1 font-mono text-cyan-300 font-bold">
              <span>$</span>
              <span>{usdc.loading ? '—' : usdc.formatted}</span>
            </span>
            <span className="text-white/20">·</span>
            <span className="flex items-center gap-1 font-mono text-violet-300 font-semibold">
              <Coins className="h-3 w-3 text-violet-400" />
              <span>{credits !== null ? credits.toLocaleString() : '—'} cr</span>
            </span>
          </Link>
        )}

        {/* Auth */}
        {!ready ? (
          <span className="text-xs text-white/30">…</span>
        ) : !authenticated ? (
          <button
            onClick={() => login()}
            className="gw-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Wallet className="h-3.5 w-3.5" />
            Connect
          </button>
        ) : (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="h-8 w-8 overflow-hidden rounded-full border border-white/[0.12] bg-gradient-to-br from-violet-500/30 to-cyan-500/20 transition hover:border-cyan-400/30"
              aria-label="Profile"
            >
              {/* Pixel avatar SVG */}
              <svg viewBox="0 0 40 40" width="100%" height="100%">
                <rect fill="#3a3a5e" height="4" width="20" x="10" y="16" />
                <rect fill="#3a3a5e" height="4" width="12" x="14" y="12" />
                <rect fill="#3a3a5e" height="4" width="8" x="16" y="8" />
                <rect fill="#fcdbb6" height="8" width="12" x="14" y="20" />
                <rect fill="#000" height="2" width="2" x="16" y="22" />
                <rect fill="#000" height="2" width="2" x="22" y="22" />
                <rect fill="#fff" height="8" width="16" x="12" y="28" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-40 w-52 rounded-xl border border-white/[0.08] bg-[#0e1016]/95 p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                <div className="mb-1 px-3 py-2 font-mono text-[10px] text-white/40">
                  {wallet ? shortAddr(wallet) : '—'}
                </div>
                <button
                  onClick={() => {
                    if (wallet) navigator.clipboard.writeText(wallet)
                    setMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-white/70 transition hover:bg-white/6 hover:text-white"
                >
                  Copy wallet address
                </button>
                <button
                  onClick={() => {
                    logout()
                    setMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-red-400 transition hover:bg-red-500/10"
                >
                  <LogOut className="h-3 w-3" />
                  Log out
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile fullscreen nav */}
      {mobileNavOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex flex-col bg-[#08090d]/95 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5">
            <span className="font-semibold tracking-tight text-white">Menu</span>
            <button
              onClick={() => setMobileNavOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/8 hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-1 p-3">
            {activeNav.map((it: NavItem) => {
              const isActive = it.match ? it.match(pathname) : pathname.startsWith(it.href)
              if (it.external) {
                return (
                  <a
                    key={it.label}
                    href={it.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMobileNavOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-white/60 transition hover:bg-white/6 hover:text-white"
                  >
                    {it.label}
                  </a>
                )
              }
              return (
                <Link
                  key={it.label}
                  href={it.href}
                  onClick={() => setMobileNavOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition ${
                    isActive
                      ? 'bg-white/8 text-white font-medium'
                      : 'text-white/60 hover:bg-white/6 hover:text-white'
                  }`}
                >
                  {it.label}
                </Link>
              )
            })}

            <div className="my-2 h-px bg-white/[0.06]" />

            <button
              onClick={() => {
                toggleHistory()
                setMobileNavOpen(false)
              }}
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-white/60 transition hover:bg-white/6 hover:text-white"
            >
              Workflow History
            </button>

            {authenticated && (
              <button
                onClick={() => {
                  logout()
                  setMobileNavOpen(false)
                }}
                className="mt-auto flex items-center gap-3 rounded-xl border border-red-500/20 px-4 py-3 text-sm text-red-400 transition hover:bg-red-500/10"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}
