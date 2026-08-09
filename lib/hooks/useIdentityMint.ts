'use client'

/**
 * useIdentityMint — ERC-8004 identity mint, driven from the console.
 *
 * Extracted from the old IdentityGate component so the terminal can run
 * the mint as a command (`mint`) and report each stage as a log line,
 * instead of blocking the whole screen behind a gate card.
 *
 * The flow is deliberately the USER-SIGNED one:
 *   /api/identity/prepare  → calldata + contract
 *   wallet.sendTransaction → msg.sender is the user, so the NFT lands in
 *                            THEIR wallet
 *   /api/identity/confirm  → server verifies signer + owner, writes the row
 *
 * It must not be swapped for /api/identity/mint: that path is admin-signed,
 * so the contract (which uses msg.sender as the recipient) would mint to
 * the admin. The user's wallet would end up with no NFT, verifyTokenOwnership
 * would fail on every /api/me, and they'd be re-prompted to mint forever.
 */
import { useCallback, useRef, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { createWalletClient, custom, type Hex } from 'viem'

import { arcTestnet, ARC_CHAIN_ID } from '@/lib/chain/arcTestnet'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { writeIdentityCache } from '@/lib/identityCache'

export type MintStage = 'idle' | 'preparing' | 'signing' | 'confirming' | 'done' | 'error'

export interface MintResult {
  tokenId: string | null
  txHash: string | null
  /** True when the server short-circuited — the wallet already owns one. */
  already: boolean
}

export function useIdentityMint(onStage?: (stage: MintStage, detail?: string) => void) {
  const { user: privyUser } = usePrivy()
  const activeWallet = useActiveWallet()
  const [stage, setStage] = useState<MintStage>('idle')
  const busyRef = useRef(false)

  const emit = useCallback(
    (s: MintStage, detail?: string) => {
      setStage(s)
      onStage?.(s, detail)
    },
    [onStage],
  )

  const mint = useCallback(async (): Promise<MintResult> => {
    if (busyRef.current) throw new Error('mint already in progress')
    busyRef.current = true
    try {
      const wallet = activeWallet
      if (!wallet) throw new Error('no wallet connected')

      emit('preparing')

      // Pre-sync the session cookie to the wallet that is about to sign.
      // The layout's SessionSync also does this, but its effect can lag a
      // just-switched extension account — and a stale cookie makes
      // /api/identity/confirm reject with "wrong_signer".
      await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: wallet.address.toLowerCase(),
          ...(privyUser?.id ? { privyId: privyUser.id } : {}),
        }),
      }).catch(() => {
        /* tolerated — confirm will surface a clear error if it mattered */
      })

      const prepRes = await fetch('/api/identity/prepare', { method: 'POST' })
      const prep = await prepRes.json()
      if (!prepRes.ok) {
        throw new Error(prep.detail || prep.error || `prepare failed (${prepRes.status})`)
      }

      if (prep.already) {
        if (wallet.address) {
          writeIdentityCache(wallet.address.toLowerCase(), {
            hasIdentity: true,
            tokenId: prep.tokenId,
            txHash: prep.txHash,
            mintedAt: new Date().toISOString(),
          })
        }
        window.dispatchEvent(new CustomEvent('gw:identity-changed'))
        emit('done')
        return { tokenId: prep.tokenId ?? null, txHash: prep.txHash ?? null, already: true }
      }

      emit('signing')

      // OKX silently rejects when on the wrong chain; switchChain is cheap
      // and a no-op for Privy embedded wallets.
      await wallet.switchChain(ARC_CHAIN_ID).catch(() => {})

      const provider = await wallet.getEthereumProvider()
      const client = createWalletClient({ chain: arcTestnet, transport: custom(provider) })
      const txHash = (await client.sendTransaction({
        account: wallet.address as `0x${string}`,
        to: prep.contract as `0x${string}`,
        data: prep.calldata as Hex,
      } as Parameters<typeof client.sendTransaction>[0])) as Hex

      emit('confirming', txHash)

      const confirmRes = await fetch('/api/identity/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      })
      const data = await confirmRes.json()
      if (!confirmRes.ok) {
        throw new Error(data.detail || data.error || `confirm failed (${confirmRes.status})`)
      }

      if (wallet.address) {
        writeIdentityCache(wallet.address.toLowerCase(), {
          hasIdentity: true,
          tokenId: data.tokenId,
          txHash: data.txHash,
          mintedAt: new Date().toISOString(),
        })
      }
      window.dispatchEvent(new CustomEvent('gw:identity-changed'))
      window.dispatchEvent(new CustomEvent('gw:credits-changed'))

      emit('done')
      return { tokenId: data.tokenId ?? null, txHash: data.txHash ?? null, already: false }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      emit('error', /user rejected|denied/i.test(msg) ? 'signature cancelled' : msg)
      throw e
    } finally {
      busyRef.current = false
    }
  }, [activeWallet, privyUser?.id, emit])

  return { mint, stage }
}
