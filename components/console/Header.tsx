'use client'

/**
 * Header — persistent top navigation, present on every surface including
 * a running workflow. Replaces the earlier bottom status line, which left
 * the run page with no way to get anywhere.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useLogin, useLogout, usePrivy } from '@privy-io/react-auth'
import { Fingerprint, Hexagon, LogOut, Wallet } from 'lucide-react'

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/deploy', label: 'Deploy' },
  { href: '/billing', label: 'Billing' },
  { href: '/history', label: 'History' },
] as const

const CHAIN_ID = process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '5042002'

interface Me {
  usdcBalance?: number
  dedicatedVaultAddress?: string | null
  identity?: { hasIdentity: boolean; tokenId: string | null }
}

export function Header() {
  const pathname = usePathname() ?? '/'
  const { ready, authenticated } = usePrivy()
  const { login } = useLogin()
  const { logout } = useLogout()
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    const load = () =>
      fetch('/api/me', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setMe(j))
        .catch(() => {})
    load()
    const onBust = () => load()
    window.addEventListener('gw:credits-changed', onBust)
    window.addEventListener('gw:session-ready', onBust)
    const t = setInterval(load, 15_000)
    return () => {
      window.removeEventListener('gw:credits-changed', onBust)
      window.removeEventListener('gw:session-ready', onBust)
      clearInterval(t)
    }
  }, [])

  const active = (href: string) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/workflow') : pathname.startsWith(href)

  return (
    <header className="gwt-header">
      <Link href="/" className="gwt-mark">
        <span className="gwt-mark-glyph">
          <Hexagon size={13} strokeWidth={2.75} />
        </span>
        <span className="gwt-mark-text">GIGAWORK</span>
      </Link>

      <nav className="flex items-center gap-0.5">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="gwt-nav" data-on={active(n.href) ? '1' : '0'}>
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {/* Chain is stated plainly: this is a testnet, and hiding that
            would be the wrong kind of polish. */}
        <span className="gwt-read" data-opt="1" title="Connected network">
          <span className="gwt-pulse" />
          <span className="gwt-read-k">arc</span>
          <span className="gwt-read-v">{CHAIN_ID}</span>
        </span>

        {me?.identity?.hasIdentity && me.identity.tokenId && (
          <span className="gwt-read" data-opt="1" title="Your ERC-8004 identity NFT">
            <Fingerprint size={12} className="text-[var(--gw-emerald)]" />
            <span className="gwt-read-k">8004</span>
            <span className="gwt-read-v">#{me.identity.tokenId}</span>
          </span>
        )}

        <Link href="/billing" className="gwt-read" data-opt="2" title="Spendable vault balance">
          <Wallet size={12} className="text-[var(--gw-cyan)]" />
          <span className="gwt-read-k">vault</span>
          <span className="gwt-read-v">
            {typeof me?.usdcBalance === 'number' ? `$${me.usdcBalance.toFixed(2)}` : '…'}
          </span>
        </Link>

        {!ready ? (
          <span className="px-2 text-white/25">…</span>
        ) : authenticated ? (
          <button
            className="gwt-read"
            onClick={() => logout()}
            title="Disconnect wallet"
            aria-label="Disconnect wallet"
          >
            <LogOut size={12} className="opacity-60" />
          </button>
        ) : (
          <button className="gwt-btn !py-1.5 !px-3.5" onClick={() => login()}>
            <Wallet size={13} />
            Connect
          </button>
        )}
      </div>
    </header>
  )
}
