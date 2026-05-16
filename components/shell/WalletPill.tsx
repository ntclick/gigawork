'use client'

import Link from 'next/link'
import { useLogin, useLogout, usePrivy } from '@privy-io/react-auth'

import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Coins,
  Crown,
  ExternalLink,
  Loader2,
  LogOut,
  Plus,
  Wallet,
  X,
} from 'lucide-react'

import { useTopup, type TopupStep } from '@/lib/hooks/useTopup'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import {
  clearIdentityCache,
  readMeCache,
  writeMeCache,
} from '@/lib/identityCache'

type Me = {
  id: string
  wallet: string
  credits: number
  identity?: { hasIdentity: boolean; tokenId: string | null; txHash: string | null }
}

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

const PRESETS = [3, 5, 10, 25]

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function WalletPill() {
  const { ready, authenticated, user } = usePrivy()
  // CRITICAL: use the SAME wallet resolution rule as every signing call
  // site (mint, escrow, validation). useActiveWallet prefers an external
  // wallet (OKX/MetaMask) over the auto-created Privy embedded wallet —
  // if the user explicitly linked an external one, they want NFTs and
  // signatures to belong to it. The cookie + DB user.wallet must track
  // the same address or signer-verification server-side fails.
  const wallet = useActiveWallet()
  const { login } = useLogin()
  const { logout } = useLogout()

  // Seed `me` from localStorage so credits + token id render instantly on
  // mount, no /api/me waterfall. We still refresh in the background.
  const initialAddr = wallet?.address?.toLowerCase() ?? null
  const [me, setMe] = useState<Me | null>(() => {
    const cached = readMeCache(initialAddr)
    if (!cached) return null
    return {
      id: cached.id,
      wallet: cached.wallet,
      credits: cached.credits,
      identity: cached.identity ?? undefined,
    }
  })
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const refresh = async () => {
    try {
      const r = await fetch('/api/me', { cache: 'no-store' })
      if (!r.ok) return
      const j = (await r.json()) as Me
      setMe(j)
      if (j.wallet) {
        writeMeCache(j.wallet.toLowerCase(), {
          id: j.id,
          wallet: j.wallet,
          credits: j.credits,
          identity: j.identity ?? null,
        })
      }
    } catch {
      /* ignore */
    }
  }

  // Sync Privy session to server-side cookies. Sends BOTH the Privy DID
  // (stable across wallet switches) and the ACTIVE wallet address.
  //
  // Source of truth: wallets[0].address — NOT user.wallet.address.
  // The former tracks the OKX/MetaMask account currently selected in the
  // extension; the latter is just the first wallet linked to the Privy
  // account and never updates on account switch. useEscrowPost signs
  // with wallets[0], so the cookie must match or signer-verification
  // server-side throws "createJob signer mismatch".
  //
  // We key the dedup on `did|addr` so either dimension changing triggers
  // a fresh sync. Idempotent: same key → no re-fetch.
  const activeAddr = wallet?.address?.toLowerCase() ?? null
  const syncedKey = useRef<string | null>(null)
  useEffect(() => {
    if (!ready) return
    const did = user?.id ?? null
    const key = did && activeAddr ? `${did}|${activeAddr}` : null
    console.log('[WalletPill] sync check', { ready, authenticated, did, activeAddr, key, prev: syncedKey.current })
    if (key && key !== syncedKey.current) {
      const prev = syncedKey.current
      syncedKey.current = key
      console.log('[WalletPill] POST /api/auth/login', { wallet: activeAddr, privyId: did })
      // Optimistic UX: when the wallet actually changes (not just first
      // sync), clear `me` so the pill stops showing the previous
      // wallet's NFT/credits until the refresh resolves. Without this,
      // users see token #X from their old wallet for ~1s after switch.
      if (prev) setMe(null)
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: activeAddr, privyId: did }),
      })
        .then(() => {
          refresh()
          // Tell IdentityGate the cookie is hot and it can hit /api/me NOW
          // — eliminates the 401-then-retry-up-to-3.5s race on first login.
          window.dispatchEvent(new CustomEvent('gw:session-ready'))
          // Notify IdentityGate / other consumers that the active wallet
          // (and therefore the resolved user + NFT) has changed. Without
          // this, IdentityGate keeps showing the previous wallet's mint
          // status until the next 'gw:credits-changed' tick.
          window.dispatchEvent(new CustomEvent('gw:identity-changed'))
        })
        .catch((e) => console.warn('[WalletPill] login failed', e))
    }
    if (!authenticated && syncedKey.current) {
      syncedKey.current = null
      fetch('/api/auth/logout', { method: 'POST' }).then(() => refresh())
    }
  }, [ready, authenticated, user?.id, activeAddr])

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    const onBust = () => refresh()
    window.addEventListener('gw:credits-changed', onBust)
    const t = setInterval(refresh, 15000)
    return () => {
      window.removeEventListener('gw:credits-changed', onBust)
      clearInterval(t)
    }
  }, [])

  if (!ready) {
    return (
      <span className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-xs text-white/45">
        <Loader2 className="h-3 w-3 animate-spin" />
        loading
      </span>
    )
  }

  if (!authenticated) {
    return (
      <button
        onClick={() => login()}
        className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-400/[0.06] px-3 py-1 text-xs font-medium text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.18)] transition hover:bg-cyan-400/15"
      >
        <Wallet className="h-3 w-3" />
        Connect wallet
      </button>
    )
  }

  const credits = me?.credits ?? 0
  const usdEquiv = (credits / 100).toFixed(2)
  const tier = credits > 1000 ? 'Pro' : 'Free'
  // Display the same wallet we sync to the server (active OKX account),
  // not user.wallet (first linked), so the pill matches what's actually
  // signing tx.
  const addr = wallet?.address ?? user?.wallet?.address ?? ''

  const verified = me?.identity?.hasIdentity ?? false

  return (
    <>
      <div className="relative flex items-center gap-2">
        {verified &&
          (me?.identity?.txHash ? (
            <a
              href={`${EXPLORER}/tx/${me.identity.txHash}`}
              target="_blank"
              rel="noreferrer"
              title={`ERC-8004 token #${me.identity.tokenId} · click to view mint tx`}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/8 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/15"
            >
              <BadgeCheck className="h-3 w-3" />
              8004 #{me.identity.tokenId}
            </a>
          ) : (
            <span
              title={`ERC-8004 token #${me?.identity?.tokenId ?? ''}`}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/8 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300"
            >
              <BadgeCheck className="h-3 w-3" />
              #{me?.identity?.tokenId}
            </span>
          ))}
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white/80 transition hover:border-cyan-400/30 hover:bg-cyan-400/10"
          title="Credit balance"
        >
          <Coins className="h-3 w-3 text-cyan-300" />
          <span className="font-mono text-cyan-200">{credits}</span>
          <span className="text-white/40">cr</span>
          <span className="text-white/30">·</span>
          <span className="text-cyan-300/85">${usdEquiv}</span>
        </button>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/[0.06] px-2.5 py-1 text-xs text-amber-200 transition hover:bg-amber-400/15"
        >
          <span className="rounded bg-white/10 px-1 text-[9px] uppercase tracking-wider">{tier}</span>
          <Crown className="h-3 w-3" />
          Upgrade
        </button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-white/75 transition hover:bg-white/10"
          title={addr}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
          {addr ? shortAddr(addr) : 'no wallet'}
        </button>
        {menuOpen && (
          <div className="gw-fade-in absolute right-0 top-9 z-40 w-44 rounded-md border border-white/10 bg-[#0f131c]/95 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur">
            <button
              onClick={() => {
                if (addr) navigator.clipboard.writeText(addr)
                setMenuOpen(false)
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-xs text-white/75 transition hover:bg-white/5"
            >
              Copy address
            </button>
            <button
              onClick={() => {
                clearIdentityCache()
                logout()
                setMenuOpen(false)
              }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-red-300 transition hover:bg-red-500/10"
            >
              <LogOut className="h-3 w-3" />
              Log out
            </button>
          </div>
        )}
      </div>
      {open && me && <TopupModal me={me} onClose={() => setOpen(false)} onUpdated={refresh} />}
    </>
  )
}

type TopupRate = {
  rate: number
  balance: number
  treasury: string
  usdcAddress: string
  usdcDecimals: number
}

const STEP_LABELS: Record<TopupStep, string> = {
  idle: 'Ready',
  signing: 'Signing USDC.transfer in wallet…',
  confirming: 'Waiting for on-chain confirmation…',
  granting: 'Server verifying + crediting…',
  done: '✓ Credits added',
  error: '✗ Error',
}

function TopupModal({
  me,
  onClose,
  onUpdated,
}: {
  me: Me
  onClose: () => void
  onUpdated: () => void
}) {
  const [usdc, setUsdc] = useState(5)
  const [tier, setTier] = useState<TopupRate | null>(null)

  // Real on-chain top-up flow — Privy wallet → USDC.transfer → /api/me/topup
  const { step, error, txHash, result, reset, topup } = useTopup()
  const usdcBalance = useUSDCBalance(me.wallet)

  useEffect(() => {
    fetch('/api/me/topup')
      .then((r) => r.json())
      .then((j) => setTier(j))
      .catch(() => {})
  }, [])

  const rate = tier?.rate ?? 100
  const credits = Math.round(usdc * rate)
  const usdcRaw = usdcBalance.raw
  const usdcDivisor = BigInt(10) ** BigInt(tier?.usdcDecimals ?? 6)
  const usdcWhole = Number(usdcRaw / usdcDivisor) +
    Number(usdcRaw % usdcDivisor) / Number(usdcDivisor)
  const insufficient = !usdcBalance.loading && usdcWhole < usdc

  const submit = async () => {
    await topup(usdc)
    // useTopup fires gw:credits-changed on success; refresh local cache too.
    if (step !== 'error') onUpdated()
  }

  const busy = step === 'signing' || step === 'confirming' || step === 'granting'
  const isDone = step === 'done' && result

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="gw-fade-in gw-gradient-border w-[420px] max-w-[92vw] rounded-2xl p-px">
        <div className="rounded-2xl bg-[#0f131c] p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-cyan-300" />
              <h3 className="text-sm font-medium text-white/95">Buy credits with USDC</h3>
            </div>
            <button onClick={onClose} className="text-white/40 hover:text-white/85">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Balance summary: USDC ví on-chain + credit hiện tại */}
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-wider text-white/45">Wallet USDC</div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="font-mono text-base text-blue-200">
                  {usdcBalance.loading ? '…' : usdcBalance.formatted}
                </span>
                <span className="text-[10px] text-white/45">USDC</span>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-wider text-white/45">Credits</div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="font-mono text-base text-cyan-200">{me.credits}</span>
                <span className="text-[10px] text-white/45">cr</span>
              </div>
            </div>
          </div>

          {/* Khi xong → success card; khi đang chạy → stepper; còn lại → form */}
          {isDone ? (
            <div className="mb-3 rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-emerald-200">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm font-medium">+{result!.granted} credits added</span>
              </div>
              <div className="text-xs text-emerald-100/80">
                New balance: <span className="font-mono">{result!.balance}</span> credits ·
                Paid {result!.usdcAmount} USDC ({result!.rate} cr/USDC)
              </div>
              <a
                href={result!.explorer}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-300 underline-offset-2 hover:underline"
              >
                View tx on explorer <ExternalLink className="h-3 w-3" />
              </a>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => { reset(); }}
                  className="flex-1 rounded-md border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
                >
                  Top up again
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 rounded-md bg-cyan-400/90 px-3 py-1.5 text-xs font-medium text-[#00363d] hover:bg-cyan-300"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-white/45">Quick pick</div>
              <div className="mb-3 grid grid-cols-4 gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    disabled={busy}
                    onClick={() => setUsdc(p)}
                    className={`rounded-md border px-2 py-1.5 text-xs transition disabled:opacity-40 ${
                      usdc === p
                        ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100'
                        : 'border-white/10 bg-white/[0.03] text-white/65 hover:border-white/20'
                    }`}
                  >
                    ${p}
                    <div className="text-[9px] text-white/45">{p * rate} cr</div>
                  </button>
                ))}
              </div>

              <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/45">
                Amount in USDC (1 USDC = {rate} credits)
              </label>
              <div className="mb-3 flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                <span className="text-white/45">$</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={usdc}
                  disabled={busy}
                  onChange={(e) => setUsdc(Number(e.target.value) || 1)}
                  className="flex-1 bg-transparent text-sm outline-none"
                />
                <span className="text-xs text-white/45">USDC</span>
              </div>

              <div className="mb-4 flex items-center justify-between rounded-md border border-cyan-400/20 bg-cyan-400/[0.05] px-3 py-2 text-xs">
                <span className="text-white/65">You will receive</span>
                <span>
                  <span className="font-mono text-cyan-200">+{credits}</span>
                  <span className="ml-1 text-white/55">credits</span>
                </span>
              </div>

              {/* Step indicator */}
              {step !== 'idle' && step !== 'error' && (
                <div className="mb-3 rounded-md border border-cyan-400/20 bg-cyan-400/[0.04] p-2 text-[11px] text-cyan-100/85">
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {STEP_LABELS[step]}
                  </div>
                  {txHash && (
                    <div className="mt-1 truncate font-mono text-[10px] text-cyan-200/70">
                      {txHash}
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="mb-3 rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
                  {error}
                </div>
              )}

              {insufficient && (
                <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/[0.08] px-3 py-2 text-xs text-amber-200">
                  Wallet has insufficient USDC on Arc Testnet (~{usdcBalance.formatted} available).
                </div>
              )}

              <button
                onClick={submit}
                disabled={busy || insufficient}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-400/90 px-3 py-2 text-sm font-medium text-[#00363d] shadow-[0_0_16px_rgba(34,211,238,0.3)] transition hover:bg-cyan-300 disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {busy ? STEP_LABELS[step] : `Buy ${credits} credits (${usdc} USDC)`}
              </button>

              <Link
                href="/finance"
                onClick={onClose}
                className="mt-3 inline-flex items-center gap-1 text-[11px] text-cyan-300/80 hover:text-cyan-200"
              >
                Open Finance panel <ArrowRight className="h-3 w-3" />
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
