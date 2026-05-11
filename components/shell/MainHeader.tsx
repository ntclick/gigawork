'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useLogin, useLogout, usePrivy, useWallets } from '@privy-io/react-auth'
import { Bell, Coins, LogOut, Menu, Wallet, X } from 'lucide-react'

import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { useUI } from './UIShell'

const ARC_NETWORK_LABEL =
  process.env.NEXT_PUBLIC_ARC_NETWORK_LABEL ?? 'Arc Testnet'
const ARC_EXPLORER =
  process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

/**
 * MainHeader — top bar matching the "GigaWork - Workflow Editor" mockup.
 *
 * - Brand logo on the left
 * - Section tabs (Dashboard / Workflows / Agents / Settings)
 * - Real on-chain USDC balance pulled from the user's connected wallet
 * - Profile avatar + menu, notifications button
 * - Mobile: collapses to logo + USDC pill + profile (nav becomes hamburger)
 */

const NAV = [
  { label: 'Home', href: '/', glyph: '⌂', match: (p: string) => p === '/' },
  { label: 'Dashboard', href: '/dashboard', glyph: '■' },
  { label: 'Workflows', href: '/', glyph: '⚡', match: (p: string) => p.startsWith('/workflow') },
  { label: 'Agents', href: '/agents', glyph: '◆' },
  { label: 'Docs', href: '/docs', glyph: '?' },
  { label: 'Finance', href: '/finance', glyph: '$' },
  { label: 'Profile', href: '/profile', glyph: '👤' },
  { label: 'Settings', href: '/settings', glyph: '⚙' },
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

  // Pick the most reliable wallet address. Privy's user.wallet can be null
  // for fresh email logins until the embedded wallet finishes provisioning,
  // so fall back to wallets[0] from useWallets() — that's already populated
  // when the embedded wallet exists. IdentityGate uses the same fallback.
  const walletAddr =
    user?.wallet?.address?.toLowerCase() ??
    wallets[0]?.address?.toLowerCase() ??
    null
  const wallet = walletAddr ?? null
  const usdc = useUSDCBalance(wallet)

  // Sync Privy wallet → server-side session cookie. Without this, every
  // /api/me, /api/workflows, /api/me/topup call returns 401 because the
  // cookie was never set after Privy login. Resets the synced ref on
  // failure so the next render retries — important when /api/auth/login
  // races with DB warm-up on a cold start and the first POST 5xxs.
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
            // Roll back so the next effect tick retries.
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
    <header className="giga-theme z-20 flex h-16 shrink-0 items-center justify-between border-b border-black bg-[var(--giga-dark)] px-3 sm:px-6">
      {/* Left: logo + nav */}
      <div className="flex min-w-0 items-center gap-3 sm:gap-8">
        {/* Mobile hamburger — opens fullscreen nav (desktop has nav inline) */}
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
          className="lg:hidden inline-flex h-8 w-8 items-center justify-center text-white/70 hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </button>

        <Link href="/" className="flex shrink-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center bg-purple-600 font-bold text-white shadow-[2px_2px_0_0_#000]">
            G
          </div>
          <span className="font-pixel-header bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-base text-transparent sm:text-lg">
            GigaWork
          </span>
        </Link>

        <nav className="hidden items-center gap-2 text-base lg:flex">
          {NAV.map((it) => {
            const isActive = it.match ? it.match(pathname) : pathname.startsWith(it.href)
            return (
              <Link
                key={it.label}
                href={it.href}
                className={[
                  'flex items-center gap-2 px-3 py-1 text-base transition-colors',
                  isActive
                    ? 'bg-[#3e3b5e] text-white'
                    : 'text-[var(--giga-text)] hover:text-white',
                ].join(' ')}
              >
                <span className={isActive ? 'text-purple-400' : 'opacity-50'}>{it.glyph}</span>
                {it.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Right: ARC + USDC + Credits + notifications + profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* ARC Testnet network badge — always visible so users know which chain they're on */}
        <a
          href={ARC_EXPLORER}
          target="_blank"
          rel="noreferrer"
          title={`Network: ${ARC_NETWORK_LABEL} · click để mở explorer`}
          className="hidden items-center gap-1.5 border-2 border-purple-500/50 bg-purple-500/10 px-2 py-1 text-purple-200 transition hover:border-purple-400 hover:bg-purple-500/20 sm:flex"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.8)]" />
          <span className="font-pixel-body text-xs uppercase tracking-wider">
            {ARC_NETWORK_LABEL}
          </span>
        </a>

        {ready && authenticated && wallet && (
          <Link
            href="/finance"
            className="flex items-center gap-2 border-2 border-[#3e3b5e] bg-[var(--giga-panel)] px-2 py-1 transition hover:border-[var(--giga-accent)] sm:px-3"
            title={`USDC balance · ${wallet} · click để mở Finance`}
          >
            <span className="text-[#60a5fa]">$</span>
            <span className="font-pixel-body text-base text-white">
              {usdc.loading ? '…' : usdc.formatted}
            </span>
            <span className="hidden text-xs text-white/45 sm:inline">USDC</span>
          </Link>
        )}

        {ready && authenticated && credits !== null && (
          <Link
            href="/finance"
            className="flex items-center gap-1.5 border-2 border-cyan-400/40 bg-cyan-400/10 px-2 py-1 transition hover:border-cyan-300 hover:bg-cyan-400/20 sm:px-3"
            title={`${credits} credits · ≈ $${(credits / 100).toFixed(2)} · click để top-up`}
          >
            <Coins className="h-3.5 w-3.5 text-cyan-300" />
            <span className="font-pixel-body text-base text-white">
              {credits.toLocaleString()}
            </span>
            <span className="hidden text-xs text-cyan-200/60 sm:inline">cr</span>
          </Link>
        )}

        <button
          type="button"
          aria-label="Notifications"
          className="hidden h-9 items-center gap-2 border-2 border-black bg-[var(--giga-panel)] px-3 hover:bg-opacity-80 md:inline-flex"
        >
          <Bell className="h-3.5 w-3.5" />
          <span className="font-pixel-body text-sm">Notifications</span>
        </button>

        {!ready ? (
          <span className="text-xs text-white/40">…</span>
        ) : !authenticated ? (
          <button
            onClick={() => login()}
            className="inline-flex items-center gap-1.5 border-2 border-black bg-[var(--giga-accent)] px-3 py-1.5 text-sm font-bold text-black hover:bg-yellow-300"
          >
            <Wallet className="h-3.5 w-3.5" />
            Connect
          </button>
        ) : (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="pixel-border-sm h-9 w-9 overflow-hidden bg-gray-700"
              aria-label="Profile"
            >
              {/* Pixel avatar SVG (matches HTML) */}
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
              <div className="absolute right-0 top-11 z-40 w-56 border-2 border-black bg-[var(--giga-panel)] p-2 text-sm">
                <div className="mb-2 border-b border-white/10 px-2 py-2 font-mono text-[11px] text-white/70">
                  {wallet ? shortAddr(wallet) : '—'}
                </div>
                <button
                  onClick={() => {
                    if (wallet) navigator.clipboard.writeText(wallet)
                    setMenuOpen(false)
                  }}
                  className="block w-full px-2 py-1.5 text-left text-xs hover:bg-white/5"
                >
                  Copy wallet
                </button>
                <button
                  onClick={() => {
                    logout()
                    setMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/10"
                >
                  <LogOut className="h-3 w-3" />
                  Log out
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile fullscreen nav — pixel SNES menu style */}
      {mobileNavOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex flex-col bg-[var(--giga-dark)]"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-center justify-between border-b-2 border-black bg-[var(--giga-panel)] px-4 py-3">
            <span className="font-pixel-header text-lg text-white">MENU</span>
            <button
              onClick={() => setMobileNavOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center border-2 border-black bg-[var(--giga-sidebar)] text-white/75 hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-2 p-4">
            {NAV.map((it) => {
              const isActive = it.match ? it.match(pathname) : pathname.startsWith(it.href)
              return (
                <Link
                  key={it.label}
                  href={it.href}
                  onClick={() => setMobileNavOpen(false)}
                  className={`flex items-center gap-3 border-2 border-black px-4 py-3 text-base transition ${
                    isActive
                      ? 'bg-[var(--giga-accent)] text-black'
                      : 'bg-[var(--giga-panel)] text-white/85 hover:bg-[#2c294e]'
                  }`}
                >
                  <span className={`text-lg ${isActive ? '' : 'opacity-70'}`}>{it.glyph}</span>
                  <span className="font-pixel-body uppercase tracking-wider">{it.label}</span>
                </Link>
              )
            })}

            <div className="my-2 h-px bg-white/10" />

            <button
              onClick={() => {
                toggleHistory()
                setMobileNavOpen(false)
              }}
              className="flex items-center gap-3 border-2 border-black bg-[var(--giga-panel)] px-4 py-3 text-base text-white/85 hover:bg-[#2c294e]"
            >
              <span className="text-lg opacity-70">📜</span>
              <span className="font-pixel-body uppercase tracking-wider">Workflow History</span>
            </button>

            {authenticated && (
              <button
                onClick={() => {
                  logout()
                  setMobileNavOpen(false)
                }}
                className="mt-auto flex items-center gap-3 border-2 border-red-500/50 bg-red-500/10 px-4 py-3 text-base text-red-200"
              >
                <LogOut className="h-4 w-4" />
                <span className="font-pixel-body uppercase tracking-wider">Log out</span>
              </button>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}
