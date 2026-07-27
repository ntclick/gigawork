'use client'

/**
 * useValidationAttest — drives the per-agent ERC-8004 ValidationRegistry
 * flow from the workflow page.
 *
 * The user owns the skill agent NFTs (because they registered the
 * agents), and the registry's `validationRequest` is ownership-gated.
 * Admin can't request on their behalf, so the user signs one tx per
 * agent. After each request lands, the server signs the matching
 * `validationResponse` as the registered validator.
 *
 * Designed to be triggered AFTER the workflow has fully settled
 * (ERC-8183 `complete()` mined). Idempotent: if a request is already
 * on-chain for a given agentId, the hook skips the popup and just
 * fires /respond, so re-clicking "Sign agent proofs" picks up where it
 * left off without duplicate popups.
 */
import { usePrivy } from '@privy-io/react-auth'

import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { useCallback, useState } from 'react'
import { createWalletClient, custom, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { arcTestnet, ARC_CHAIN_ID } from '@/lib/chain/arcTestnet'

export type AttestStep =
  | 'idle'
  | 'preparing'
  | 'signing'
  | 'responding'
  | 'done'
  | 'error'

export interface AttestProgress {
  agentId: string
  status: 'pending' | 'signing' | 'responding' | 'done' | 'skipped' | 'error'
  requestTx?: Hex
  responseTx?: Hex
  error?: string
}

export interface UseValidationAttestReturn {
  step: AttestStep
  error: string | null
  items: AttestProgress[]
  /** Count of agentIds the user can sign for. -1 = not yet probed. */
  pendingCount: number
  attest: (workflowId: string, customPrivateKey?: string) => Promise<void>
  /** Fire-only-fetch: hits /prepare so the UI knows how many proofs
   *  the user needs to sign without popping any wallet. Safe to call
   *  on workflow page mount. */
  probe: (workflowId: string) => Promise<void>
  reset: () => void
}

export function useValidationAttest(): UseValidationAttestReturn {
  const activeWallet = useActiveWallet()
  const { user: privyUser } = usePrivy()
  const [step, setStep] = useState<AttestStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<AttestProgress[]>([])
  // -1 = not probed yet; 0+ = pending signature count from /prepare
  const [pendingCount, setPendingCount] = useState<number>(-1)

  const reset = useCallback(() => {
    setStep('idle')
    setError(null)
    setItems([])
    setPendingCount(-1)
  }, [])

  const probe = useCallback(async (workflowId: string) => {
    try {
      const r = await fetch(
        `/api/workflow/${workflowId}/validation/prepare`,
        { method: 'POST' },
      )
      if (!r.ok) {
        setPendingCount(0) // treat errors as "nothing to sign" so UI doesn't hang
        return
      }
      const prep = await r.json()
      const list = (prep.items ?? []) as Array<{ already: boolean }>
      // Tokens already on-chain don't need a popup, just /respond — they
      // still count as pending until reconciled, but they don't block UX.
      const needSign = list.filter((c) => !c.already).length
      setPendingCount(needSign)
    } catch {
      setPendingCount(0)
    }
  }, [])

  const attest = useCallback(
    async (workflowId: string, customPrivateKey?: string) => {
      setError(null)
      setItems([])
      setStep('preparing')

      let client: any
      let signerAddress: `0x${string}`

      if (customPrivateKey) {
        const acc = privateKeyToAccount(customPrivateKey as `0x${string}`)
        signerAddress = acc.address
        const rpcUrl = process.env.NEXT_PUBLIC_ARC_RPC ?? 'https://arc-testnet.g.alchemy.com/v2/cxzxMQobCJKW1pAWWsPPW'
        client = createWalletClient({
          account: acc,
          chain: arcTestnet,
          transport: http(rpcUrl),
        })
      } else {
        const wallet = activeWallet
        if (!wallet) {
          setStep('error')
          setError('No wallet connected')
          return
        }
        signerAddress = wallet.address as `0x${string}`
        try {
          await wallet.switchChain(ARC_CHAIN_ID)
        } catch (e) {
          console.warn('[validate] switchChain failed (tolerating)', e)
        }
        const provider = await wallet.getEthereumProvider()
        client = createWalletClient({
          chain: arcTestnet,
          transport: custom(provider),
        })
      }

      // Pre-sync cookie to the wallet that will sign — same pattern as
      // useEscrowPost so /respond's `wrong_signer` check sees the right
      // address even if the user just switched accounts in OKX.
      try {
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: signerAddress.toLowerCase(),
            ...(privyUser?.id ? { privyId: privyUser.id } : {}),
          }),
        })
      } catch (e) {
        console.warn('[validate] pre-sync auth failed (tolerating)', e)
      }

      // ── Fetch the list of agentIds the user needs to sign for ─────
      let prep
      try {
        const r = await fetch(
          `/api/workflow/${workflowId}/validation/prepare`,
          { method: 'POST' },
        )
        prep = await r.json()
        if (!r.ok) throw new Error(prep.error ?? `prepare ${r.status}`)
      } catch (e) {
        setStep('error')
        setError(e instanceof Error ? e.message : String(e))
        return
      }

      const candidates: Array<{
        agentId: string
        calldata: Hex
        requestHash: Hex
        already: boolean
      }> = prep.items ?? []
      const contract = prep.contract as `0x${string}`

      if (candidates.length === 0) {
        // Nothing to do — either no user-owned skill agents on this
        // workflow, or admin already attested them all (filtered out
        // server-side). Mark done so the UI can render the empty state.
        setStep('done')
        return
      }

      const initial: AttestProgress[] = candidates.map((c) => ({
        agentId: c.agentId,
        status: 'pending',
      }))
      setItems(initial)

      // ── Per agent: sign request (if needed) + ask server to respond ──
      for (const c of candidates) {
        setItems((prev) =>
          prev.map((p) =>
            p.agentId === c.agentId ? { ...p, status: 'signing' } : p,
          ),
        )

        let requestTx: Hex
        if (c.already) {
          // Request already mined in a previous attempt — skip the popup
          // and reuse the prior tx hash. We don't have it here so we
          // pass the requestHash and let /respond verify on-chain state.
          requestTx = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
        } else {
          setStep('signing')
          try {
            requestTx = (await client.sendTransaction({
              account: signerAddress,
              to: contract,
              data: c.calldata,
            } as Parameters<typeof client.sendTransaction>[0])) as Hex
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            const cancelled = /user rejected|denied/i.test(msg)
            setItems((prev) =>
              prev.map((p) =>
                p.agentId === c.agentId
                  ? { ...p, status: cancelled ? 'skipped' : 'error', error: msg }
                  : p,
              ),
            )
            if (cancelled) continue // skip this agent, try next
            setStep('error')
            setError(msg)
            return
          }
        }

        setItems((prev) =>
          prev.map((p) =>
            p.agentId === c.agentId
              ? { ...p, status: 'responding', requestTx }
              : p,
          ),
        )
        setStep('responding')

        try {
          const r = await fetch(
            `/api/workflow/${workflowId}/validation/respond`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agentId: c.agentId,
                requestHash: c.requestHash,
                requestTxHash: requestTx,
              }),
            },
          )
          const data = await r.json()
          if (!r.ok) throw new Error(data.detail ?? data.error ?? `respond ${r.status}`)
          setItems((prev) =>
            prev.map((p) =>
              p.agentId === c.agentId
                ? { ...p, status: 'done', responseTx: data.responseTx }
                : p,
            ),
          )
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setItems((prev) =>
            prev.map((p) =>
              p.agentId === c.agentId
                ? { ...p, status: 'error', error: msg }
                : p,
            ),
          )
        }
      }

      setStep('done')
    },
    [activeWallet, privyUser?.id],
  )

  return { step, error, items, pendingCount, attest, probe, reset }
}
