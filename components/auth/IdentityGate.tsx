'use client'

import { useEffect, useState } from 'react'
import { useLogin, usePrivy } from '@privy-io/react-auth'
import { BadgeCheck, ExternalLink, Loader2, ShieldCheck, Wallet } from 'lucide-react'

type Identity = {
  hasIdentity: boolean
  tokenId: string | null
  txHash: string | null
  mintedAt: string | null
}

const IDENTITY_REGISTRY = (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ??
  '0x8004A818BFB912233c491871b3d84c89A494BD9e') as `0x${string}`
const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
const ARC_CHAIN_ID = 5042002

export function IdentityGate({
  children,
  mode = 'block',
}: {
  children: React.ReactNode
  /** 'block' (default) hides children until minted. 'banner' renders the
   *  identity prompt above and always shows children below — useful on the
   *  home page where templates should stay browsable while the user mints. */
  mode?: 'block' | 'banner'
}) {
  const { ready, authenticated } = usePrivy()
  const { login } = useLogin()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [step, setStep] = useState<'idle' | 'signing' | 'confirming'>('idle')
  const [err, setErr] = useState<string | null>(null)

  const refresh = async (): Promise<'ok' | 'unauth' | 'error'> => {
    try {
      const r = await fetch('/api/me', { cache: 'no-store' })
      if (r.ok) {
        const j = await r.json()
        setIdentity(j.identity)
        return 'ok'
      }
      if (r.status === 401) return 'unauth'
      return 'error'
    } catch {
      return 'error'
    }
  }

  // Re-run /api/me on credit/identity changes after we have an identity row.
  useEffect(() => {
    const onBust = () => refresh()
    window.addEventListener('gw:credits-changed', onBust)
    window.addEventListener('gw:identity-changed', onBust)
    return () => {
      window.removeEventListener('gw:credits-changed', onBust)
      window.removeEventListener('gw:identity-changed', onBust)
    }
  }, [])

  // Initial load — if Privy says authenticated, /api/me may 401 briefly while
  // WalletPill is still POSTing to /api/auth/login (cookie race). Retry up to
  // ~3.5s, then surface the mint CTA so the user is never stuck on the
  // "Reading identity…" spinner. If the user is genuinely not authenticated,
  // the !authenticated branch below handles it (Connect wallet CTA).
  useEffect(() => {
    if (!ready) return
    if (!authenticated) {
      setIdentity(null)
      return
    }
    let cancelled = false
    let attempts = 0
    const tick = async () => {
      if (cancelled) return
      const res = await refresh()
      if (cancelled) return
      if (res === 'ok') return
      attempts++
      if (attempts < 5) {
        setTimeout(tick, 700)
        return
      }
      // Gave up after ~3.5s — assume no identity yet so the mint button shows.
      // The mint button itself will hit /api/identity/mint which is auth-gated,
      // so a misclassification can't let an unauthenticated user mint.
      setIdentity({ hasIdentity: false, tokenId: null, txHash: null, mintedAt: null })
    }
    tick()
    return () => {
      cancelled = true
    }
  }, [ready, authenticated])

  const mint = async () => {
    setErr(null)
    try {
      setStep('signing')
      // v2 uses sponsored mint: the server admin wallet pays gas + signs the
      // register() tx, and the user row is updated with the resulting
      // tokenId. The user's Privy wallet doesn't need any testnet ETH.
      // v3 will switch back to user-signed once the embedded wallet has
      // a faucet path. Trade-off: the on-chain owner is the admin, but
      // the DB record binds the token id to this user's wallet so all
      // ERC-8183 jobs they post resolve back here.
      const r = await fetch('/api/identity/mint', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(j.detail || j.error || `mint failed (${r.status})`)
      }
      setStep('confirming')
      await refresh()
      window.dispatchEvent(new CustomEvent('gw:identity-changed'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErr(msg)
    } finally {
      setStep('idle')
    }
  }

  if (!ready) {
    return <Lock icon={<Loader2 className="h-5 w-5 animate-spin text-cyan-300" />} title="Initializing…" body="" />
  }

  if (!authenticated) {
    const lock = (
      <Lock
        icon={<Wallet className="h-6 w-6 text-cyan-300" />}
        title="Connect a wallet to get started"
        body="Connect with Privy to claim 300 free credits and mint your ERC-8004 identity NFT — required before creating your first workflow."
        cta={{ label: 'Connect wallet', onClick: () => login() }}
      />
    )
    return mode === 'banner' ? (
      <>
        <div className="mb-6">{lock}</div>
        {children}
      </>
    ) : (
      lock
    )
  }

  if (!identity) {
    const lock = (
      <Lock
        icon={<Loader2 className="h-5 w-5 animate-spin text-cyan-300" />}
        title="Loading identity…"
        body=""
      />
    )
    return mode === 'banner' ? (
      <>
        <div className="mb-6">{lock}</div>
        {children}
      </>
    ) : (
      lock
    )
  }

  if (!identity.hasIdentity) {
    const label =
      step === 'signing' ? 'Signing transaction…' :
      step === 'confirming' ? 'Verifying on-chain…' :
      'Mint identity NFT (ERC-8004)'
    const lock = (
      <Lock
        icon={<ShieldCheck className="h-6 w-6 text-cyan-300" />}
        title="🎁 You have 300 credits — mint your NFT to unlock"
        body="You've been granted 300 credits. Mint your ERC-8004 identity NFT with your own Privy wallet — admin never signs for you. Every workflow you run is bound to this token id so provider agents know you're a verified client."
        cta={{ label, onClick: mint, disabled: step !== 'idle' }}
        error={err}
        footer={`Contract ${IDENTITY_REGISTRY.slice(0, 10)}…${IDENTITY_REGISTRY.slice(-4)} · Arc Testnet (chainId ${ARC_CHAIN_ID})`}
      />
    )
    return mode === 'banner' ? (
      <>
        <div className="mb-6">{lock}</div>
        {children}
      </>
    ) : (
      lock
    )
  }

  return (
    <>
      <VerifiedBadge tokenId={identity.tokenId!} txHash={identity.txHash!} />
      {children}
    </>
  )
}

function Lock({
  icon,
  title,
  body,
  cta,
  error,
  footer,
}: {
  icon: React.ReactNode
  title: string
  body: string
  cta?: { label: string; onClick: () => void; disabled?: boolean }
  error?: string | null
  footer?: string
}) {
  return (
    <div className="gw-fade-in gw-gradient-border w-full rounded-2xl p-px">
      <div className="rounded-2xl bg-[#0f131c]/90 p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 shadow-[0_0_20px_rgba(34,211,238,0.25)]">
          {icon}
        </div>
        <h2 className="mb-1.5 text-lg font-semibold text-white/95">{title}</h2>
        {body && <p className="mx-auto mb-4 max-w-md text-sm leading-relaxed text-white/55">{body}</p>}
        {cta && (
          <button
            onClick={cta.onClick}
            disabled={cta.disabled}
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-400/90 px-4 py-2 text-sm font-medium text-[#00363d] shadow-[0_0_18px_rgba(34,211,238,0.3)] transition hover:bg-cyan-300 disabled:opacity-40"
          >
            {cta.label}
          </button>
        )}
        {error && (
          <div className="mx-auto mt-3 max-w-md rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
        {footer && <p className="mt-3 text-[10px] text-white/30">{footer}</p>}
      </div>
    </div>
  )
}

function VerifiedBadge({ tokenId, txHash }: { tokenId: string; txHash: string }) {
  return (
    <a
      href={`${EXPLORER}/tx/${txHash}`}
      target="_blank"
      rel="noreferrer"
      className="gw-fade-in mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/8 px-3 py-1 text-[10px] uppercase tracking-widest text-emerald-300 transition hover:bg-emerald-500/15"
    >
      <BadgeCheck className="h-3 w-3" />
      ERC-8004 client · token #{tokenId}
      <ExternalLink className="h-2.5 w-2.5 opacity-70" />
    </a>
  )
}
