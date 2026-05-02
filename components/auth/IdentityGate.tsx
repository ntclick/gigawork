'use client'

import { useEffect, useState } from 'react'
import { useLogin, usePrivy, useWallets } from '@privy-io/react-auth'
import { createWalletClient, custom, encodeFunctionData, parseAbi } from 'viem'
import { BadgeCheck, ExternalLink, Loader2, ShieldCheck, Wallet } from 'lucide-react'

type Identity = {
  hasIdentity: boolean
  tokenId: string | null
  txHash: string | null
  mintedAt: string | null
}

const IDENTITY_REGISTRY = (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ??
  '0x8004A818BFB912233c491871b3d84c89A494BD9e') as `0x${string}`
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
const ARC_CHAIN_ID = 5042002

const identityAbi = parseAbi([
  'function register(string agentURI) external returns (uint256 agentId)',
])

export function IdentityGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user } = usePrivy()
  const { login } = useLogin()
  const { wallets } = useWallets()
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
    const wallet = wallets.find((w) => w.address?.toLowerCase() === user?.wallet?.address?.toLowerCase()) ?? wallets[0]
    if (!wallet) {
      setErr('No Privy wallet found')
      return
    }

    try {
      setStep('signing')
      // Make sure the wallet is on Arc testnet before signing.
      try {
        await wallet.switchChain(ARC_CHAIN_ID)
      } catch (e) {
        // Some external wallets reject silently if already correct.
        console.debug('switchChain skipped', e)
      }

      const provider = await wallet.getEthereumProvider()
      const walletClient = createWalletClient({
        // chain config left to the EIP-1193 provider (already switched above)
        transport: custom(provider),
      })

      const agentURI = `${APP_URL}/agent/${wallet.address.toLowerCase()}/client`
      const data = encodeFunctionData({
        abi: identityAbi,
        functionName: 'register',
        args: [agentURI],
      })

      const txHash = await walletClient.sendTransaction({
        account: wallet.address as `0x${string}`,
        to: IDENTITY_REGISTRY,
        data,
        chain: null,
      })

      setStep('confirming')
      const r = await fetch('/api/identity/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ? `${j.error}: ${j.detail ?? ''}` : await r.text())
      }
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
    return (
      <Lock
        icon={<Wallet className="h-6 w-6 text-cyan-300" />}
        title="Connect a wallet to get started"
        body="You need a wallet to mint your identity NFT (ERC-8004) — required for any ERC-8183 job."
        cta={{ label: 'Connect wallet', onClick: () => login() }}
      />
    )
  }

  if (!identity) {
    return <Lock icon={<Loader2 className="h-5 w-5 animate-spin text-cyan-300" />} title="Reading identity…" body="" />
  }

  if (!identity.hasIdentity) {
    const label =
      step === 'signing' ? 'Signing transaction…' :
      step === 'confirming' ? 'Verifying on-chain…' :
      'Mint identity NFT (ERC-8004)'
    return (
      <Lock
        icon={<ShieldCheck className="h-6 w-6 text-cyan-300" />}
        title="Mint your identity NFT"
        body="This NFT carries role=client metadata. You sign with your own Privy wallet — admin never touches it. Every future job is bound to your token ID so provider agents know to trust you."
        cta={{ label, onClick: mint, disabled: step !== 'idle' }}
        error={err}
        footer={`Contract ${IDENTITY_REGISTRY.slice(0, 10)}…${IDENTITY_REGISTRY.slice(-4)} · Arc Testnet (chainId ${ARC_CHAIN_ID})`}
      />
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
