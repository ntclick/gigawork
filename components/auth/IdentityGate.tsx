'use client'

import { useEffect, useRef, useState } from 'react'
import { useLogin, usePrivy } from '@privy-io/react-auth'

import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { BadgeCheck, ExternalLink, Loader2, ShieldCheck, Wallet } from 'lucide-react'
import { createWalletClient, custom, type Hex } from 'viem'

import { arcTestnet } from '@/lib/chain/arcTestnet'
import {
  clearIdentityCache,
  readIdentityCache,
  writeIdentityCache,
} from '@/lib/identityCache'

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
  const { ready, authenticated, user: privyUser } = usePrivy()
  const { login } = useLogin()
  const activeWallet = useActiveWallet()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [checked, setChecked] = useState(false) // true once initial /api/me probe finishes
  const [step, setStep] = useState<'idle' | 'signing' | 'confirming'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const mintingRef = useRef(false)

  const walletAddr = activeWallet?.address?.toLowerCase() ?? null

  // Track the wallet we last fetched against, so a swap (OKX account flip,
  // Privy logout→login with a different wallet) triggers a fresh /api/me
  // probe instead of trusting the prior wallet's cache.
  const lastFetchedWalletRef = useRef<string | null>(null)

  const refresh = async (wallet: string | null): Promise<'ok' | 'unauth' | 'error'> => {
    try {
      const r = await fetch('/api/me', { cache: 'no-store' })
      if (r.ok) {
        const j = await r.json()
        const id = j.identity as Identity | null
        setIdentity(id)
        if (wallet && id) {
          writeIdentityCache(wallet, {
            hasIdentity: id.hasIdentity,
            tokenId: id.tokenId,
            txHash: id.txHash,
            mintedAt: id.mintedAt,
          })
        }
        return 'ok'
      }
      if (r.status === 401) return 'unauth'
      return 'error'
    } catch {
      return 'error'
    }
  }

  // Re-run /api/me on credit/identity changes after we have an identity row.
  //   - gw:session-ready  fires once WalletPill's /api/auth/login POST
  //     resolves; we kick a /api/me fetch immediately so the NFT badge
  //     shows the moment the cookie is hot (no 401-retry wait).
  useEffect(() => {
    const onBust = () => refresh(walletAddr)
    window.addEventListener('gw:credits-changed', onBust)
    window.addEventListener('gw:identity-changed', onBust)
    window.addEventListener('gw:session-ready', onBust)
    return () => {
      window.removeEventListener('gw:credits-changed', onBust)
      window.removeEventListener('gw:identity-changed', onBust)
      window.removeEventListener('gw:session-ready', onBust)
    }
  }, [walletAddr])

  // Initial load — cache-first, network fallback.
  //
  // Order:
  //  1. If we have a cached entry for the active wallet, render it
  //     synchronously — no spinner, no /api/me roundtrip. We trust the
  //     cache until the user explicitly logs out, mints, or switches to
  //     a different wallet (which is keyed separately, so cache misses).
  //  2. Otherwise hit /api/me. With Privy cookie race, retry up to ~3.5s.
  //  3. On Privy logout (authenticated flips false AND no session) clear
  //     ALL cached entries — the next user on this device starts clean.
  useEffect(() => {
    if (!ready) return

    // Privy says logged out → wipe cache + show connect prompt.
    if (!authenticated && !walletAddr) {
      clearIdentityCache()
      setTimeout(() => {
        setIdentity(null)
        setChecked(true)
      }, 0)
      lastFetchedWalletRef.current = null
      return
    }

    // Cache hit for the current wallet — render instantly.
    const cached = readIdentityCache(walletAddr)
    if (cached && lastFetchedWalletRef.current !== walletAddr) {
      setTimeout(() => {
        setIdentity({
          hasIdentity: cached.hasIdentity,
          tokenId: cached.tokenId,
          txHash: cached.txHash,
          mintedAt: cached.mintedAt,
        })
        setChecked(true)
      }, 0)
      lastFetchedWalletRef.current = walletAddr
      return
    }

    // Already fetched for this wallet on this mount — don't refetch.
    if (lastFetchedWalletRef.current === walletAddr && checked) return

    let cancelled = false
    let attempts = 0
    const tick = async () => {
      if (cancelled) return
      const res = await refresh(walletAddr)
      if (cancelled) return
      if (res === 'ok') {
        setChecked(true)
        lastFetchedWalletRef.current = walletAddr
        return
      }
      if (!authenticated) {
        setIdentity(null)
        setChecked(true)
        return
      }
      attempts++
      if (attempts < 5) {
        setTimeout(tick, 700)
        return
      }
      setIdentity({ hasIdentity: false, tokenId: null, txHash: null, mintedAt: null })
      setChecked(true)
    }
    tick()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, walletAddr])

  const mint = async () => {
    if (mintingRef.current) return // prevent double-call from rapid clicks
    mintingRef.current = true
    setErr(null)
    try {
      const wallet = activeWallet
      if (!wallet) throw new Error('No wallet connected')

      // 0. Pre-sync cookie to the wallet that's about to sign. WalletPill
      //    also POSTs /api/auth/login on render, but its useEffect can
      //    lag when the user just switched accounts in their extension.
      //    Without this sync, /api/identity/confirm sees stale cookie
      //    wallet and throws "wrong_signer: expected from=A, got from=B".
      try {
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: wallet.address.toLowerCase(),
            ...(privyUser?.id ? { privyId: privyUser.id } : {}),
          }),
        })
      } catch (e) {
        console.warn('[identity-mint] pre-sync auth failed (tolerating)', e)
      }

      // 1. Server returns calldata + contract address. We do NOT call
      //    /api/identity/mint — that's an admin-signed path which mints
      //    to the admin's address (because the contract uses msg.sender
      //    as the recipient). That route leaves the user's wallet with
      //    NO NFT, which then trips verifyTokenOwnership on every
      //    subsequent /api/me and re-prompts mint forever. The user-sign
      //    flow below ensures msg.sender = user.wallet, so the NFT
      //    actually lands in their wallet.
      const prepRes = await fetch('/api/identity/prepare', { method: 'POST' })
      const prep = await prepRes.json()
      if (!prepRes.ok) {
        throw new Error(prep.detail || prep.error || `prepare failed (${prepRes.status})`)
      }
      // Server short-circuited because the row already has a token id.
      if (prep.already) {
        const id: Identity = {
          hasIdentity: true,
          tokenId: prep.tokenId,
          txHash: prep.txHash,
          mintedAt: new Date().toISOString(),
        }
        setIdentity(id)
        if (walletAddr) writeIdentityCache(walletAddr, id)
        window.dispatchEvent(new CustomEvent('gw:identity-changed'))
        return
      }

      setStep('signing')

      // 2. Ensure wallet is on Arc Testnet before signing — OKX silently
      //    rejects when on the wrong chain. Privy embedded wallets are
      //    already pinned; switchChain is cheap & idempotent there.
      try {
        await wallet.switchChain(ARC_CHAIN_ID)
      } catch (e) {
        console.warn('[identity/mint] switchChain failed (tolerating)', e)
      }

      const provider = await wallet.getEthereumProvider()
      const userAddr = wallet.address as `0x${string}`
      const client = createWalletClient({
        chain: arcTestnet,
        transport: custom(provider),
      })
      console.log('[identity-mint] signing tx', { userAddr, to: prep.contract })
      const txHash = (await client.sendTransaction({
        account: userAddr,
        to: prep.contract as `0x${string}`,
        data: prep.calldata as Hex,
      } as Parameters<typeof client.sendTransaction>[0])) as Hex
      console.log('[identity-mint] tx broadcast', txHash)

      setStep('confirming')

      // 3. Server verifies tx (success, signer == user.wallet, owner ==
      //    user.wallet) and writes the DB row + grants signup bonus.
      const confirmRes = await fetch('/api/identity/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      })
      const data = await confirmRes.json()
      console.log('[identity-mint] confirm response', { status: confirmRes.status, data, txHash })
      if (!confirmRes.ok) {
        throw new Error(data.detail || data.error || `confirm failed (${confirmRes.status})`)
      }

      const id: Identity = {
        hasIdentity: true,
        tokenId: data.tokenId,
        txHash: data.txHash,
        mintedAt: new Date().toISOString(),
      }
      setIdentity(id)
      if (walletAddr) writeIdentityCache(walletAddr, id)
      window.dispatchEvent(new CustomEvent('gw:identity-changed'))
      window.dispatchEvent(new CustomEvent('gw:credits-changed'))
      refresh(walletAddr).catch(() => {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // EIP-1193 user reject — show a friendlier message
      if (/user rejected|denied/i.test(msg)) {
        setErr('Transaction signature cancelled — click Mint to try again.')
      } else {
        setErr(msg)
      }
    } finally {
      setStep('idle')
      mintingRef.current = false
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
        title="🎁 Unlock 300 Free Trial Credits"
        body="Welcome to GigaWork! Activate your secure Digital Identity Card (ERC-8004) to instantly receive 300 free Credits. This identity card is an on-chain attestation that helps AI Agents verify you as a valid customer and protects your work results."
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
      title="Connect Wallet to Get Started"
      body="Connect your account via Privy to automatically receive 300 free trial Credits and activate your secure Digital Identity Card (ERC-8004)."
      cta={{ label: 'Connect Wallet Now', onClick: () => login() }}
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
