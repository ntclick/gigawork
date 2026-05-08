'use client'

import { useEffect, useState } from 'react'
import { useLogin, usePrivy, useWallets } from '@privy-io/react-auth'
import { BadgeCheck, ExternalLink, Loader2, ShieldCheck, Wallet } from 'lucide-react'
import { createWalletClient, custom, encodeFunctionData, parseAbi, type Hex } from 'viem'

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

const identityAbi = parseAbi([
  'function register(string agentURI) external returns (uint256 agentId)',
])

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
  const { wallets } = useWallets()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [checked, setChecked] = useState(false) // true once initial /api/me probe finishes
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

  // Initial load — probe /api/me first. In DEV_WALLET mode the server has a
  // valid session even though Privy `authenticated` is false, so we must check
  // the real session before falling back to Privy's auth state.
  //
  // For production Privy flow: if /api/me returns 401 initially (cookie race
  // while WalletPill POSTs /api/auth/login), retry up to ~3.5s.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    let attempts = 0
    const tick = async () => {
      if (cancelled) return
      const res = await refresh()
      if (cancelled) return
      if (res === 'ok') {
        setChecked(true)
        return // DEV_WALLET or real session — identity set
      }
      // No session from server — if Privy also says not authenticated, stop.
      if (!authenticated) {
        setIdentity(null)
        setChecked(true)
        return
      }
      // Privy says authenticated but /api/me isn't ready yet (cookie race).
      attempts++
      if (attempts < 5) {
        setTimeout(tick, 700)
        return
      }
      // Gave up after ~3.5s — assume no identity yet so the mint button shows.
      // The mint button itself will hit /api/identity/mint which is auth-gated,
      // so a misclassification can't let an unauthenticated user mint.
      setIdentity({ hasIdentity: false, tokenId: null, txHash: null, mintedAt: null })
      setChecked(true)
    }
    tick()
    return () => {
      cancelled = true
    }
  }, [ready, authenticated])

  const mint = async () => {
    setErr(null)
    try {
      const wallet = wallets[0]
      if (!wallet) throw new Error('No wallet connected')

      setStep('confirming')

      const res = await fetch('/api/identity/mint', {
        method: 'POST',
      })
      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.detail || data.error || `mint failed (${res.status})`)
      }

      setIdentity({
        hasIdentity: true,
        tokenId: data.tokenId,
        txHash: data.txHash,
        mintedAt: new Date().toISOString(),
      })
      window.dispatchEvent(new CustomEvent('gw:identity-changed'))
      window.dispatchEvent(new CustomEvent('gw:credits-changed'))
      refresh().catch(() => {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErr(msg)
    } finally {
      setStep('idle')
    }
  }

  // ── Render gates ─────────────────────────────────────────────
  // Wait until both Privy SDK and our /api/me probe are done before
  // rendering any gate — avoids the "Connect wallet" flash.

  if (!ready || !checked) {
    const loading = (
      <Lock
        icon={<Loader2 className="h-5 w-5 animate-spin text-cyan-300" />}
        title="Initializing…"
        body=""
      />
    )
    return mode === 'banner' ? (
      <>
        <div className="mb-4">{loading}</div>
        {children}
      </>
    ) : loading
  }

  // ① Already minted → show verified badge, no banners.
  if (identity?.hasIdentity) {
    return (
      <>
        <VerifiedBadge tokenId={identity.tokenId!} txHash={identity.txHash!} />
        {children}
      </>
    )
  }

  // ② Connected (session exists) but hasn't minted yet → show mint CTA.
  if (identity && !identity.hasIdentity) {
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

  // ③ No session at all → prompt to connect wallet via Privy.
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
