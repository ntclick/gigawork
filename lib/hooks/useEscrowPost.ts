'use client'

/**
 * useEscrowPost — drives the user-as-client ERC-8183 lifecycle from the
 * frontend. Pairs with /api/workflow/escrow/{prepare,post-create,confirm}.
 *
 * State machine:
 *   idle
 *   → preparing       : POST /prepare to fetch createJob + approve calldata
 *   → signing-create  : Privy popup #1 — user signs createJob
 *   → posting-create  : POST /post-create, server admin signs setBudget +
 *                       returns fund calldata
 *   → signing-approve : Privy popup #2 — user signs USDC.approve
 *   → signing-fund    : Privy popup #3 — user signs fund(jobId)
 *   → confirming      : POST /confirm to verify both tx hashes
 *   → done | error
 *
 * Idempotent: if /prepare returns `already: true`, hook short-circuits to
 * done. Each step's failure leaves DB in a re-resumable state — next call
 * to post() will pick up where it left off.
 */
import { useWallets } from '@privy-io/react-auth'
import { useCallback, useState } from 'react'
import { createWalletClient, custom, type Hex } from 'viem'

const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '5042002')

export type EscrowStep =
  | 'idle'
  | 'preparing'
  | 'signing-create'
  | 'posting-create'
  | 'signing-approve'
  | 'signing-fund'
  | 'confirming'
  | 'done'
  | 'error'

export interface EscrowResult {
  jobId: string
  createTx: Hex
  setBudgetTx: Hex
  approveTx: Hex
  fundTx: Hex
}

export interface UseEscrowPostReturn {
  step: EscrowStep
  error: string | null
  result: EscrowResult | null
  txHashes: Partial<Record<'create' | 'approve' | 'fund', Hex>>
  reset: () => void
  post: (workflowId: string) => Promise<void>
}

export function useEscrowPost(): UseEscrowPostReturn {
  const { wallets } = useWallets()
  const [step, setStep] = useState<EscrowStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EscrowResult | null>(null)
  const [txHashes, setTxHashes] = useState<Partial<Record<'create' | 'approve' | 'fund', Hex>>>({})

  const reset = useCallback(() => {
    setStep('idle')
    setError(null)
    setResult(null)
    setTxHashes({})
  }, [])

  const post = useCallback(
    async (workflowId: string) => {
      setError(null)
      setResult(null)
      setTxHashes({})

      const wallet = wallets[0]
      if (!wallet) {
        setStep('error')
        setError('No wallet connected')
        return
      }

      try {
        // ── 1. prepare ──────────────────────────────────────────
        setStep('preparing')
        const prepRes = await fetch('/api/workflow/escrow/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId }),
        })
        const prep = (await prepRes.json().catch(() => ({}))) as {
          ok?: boolean
          already?: boolean
          jobId?: string
          createTx?: string
          fundTx?: string
          contract?: string
          usdcContract?: string
          budget?: string
          createJob?: { to: string; data: string }
          approve?: { to: string; data: string }
          error?: string
          detail?: string
        }
        if (!prepRes.ok) {
          throw new Error(prep.detail || prep.error || `prepare ${prepRes.status}`)
        }
        if (prep.already) {
          setStep('done')
          return
        }
        if (!prep.createJob || !prep.approve || !prep.budget || !prep.contract) {
          throw new Error('prepare returned incomplete bundle')
        }

        // Switch chain once up front. Privy embedded wallets noop if already correct.
        try {
          await wallet.switchChain(ARC_CHAIN_ID)
        } catch {
          /* tolerate */
        }
        const provider = await wallet.getEthereumProvider()
        const walletClient = createWalletClient({ transport: custom(provider) })
        const userAddr = wallet.address as `0x${string}`

        // ── 2. user signs createJob ────────────────────────────
        setStep('signing-create')
        const createTx = (await walletClient.sendTransaction({
          account: userAddr,
          to: prep.createJob.to as `0x${string}`,
          data: prep.createJob.data as Hex,
          chain: null,
        })) as Hex
        setTxHashes((s) => ({ ...s, create: createTx }))

        // ── 3. backend admin signs setBudget ───────────────────
        setStep('posting-create')
        const postRes = await fetch('/api/workflow/escrow/post-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId, createJobTxHash: createTx, budget: prep.budget }),
        })
        const post = (await postRes.json().catch(() => ({}))) as {
          ok?: boolean
          jobId?: string
          setBudgetTx?: Hex
          fund?: { data: string }
          error?: string
          detail?: string
        }
        if (!postRes.ok || !post.jobId || !post.setBudgetTx || !post.fund?.data) {
          throw new Error(post.detail || post.error || `post-create ${postRes.status}`)
        }

        // ── 4. user signs approve ──────────────────────────────
        setStep('signing-approve')
        const approveTx = (await walletClient.sendTransaction({
          account: userAddr,
          to: prep.usdcContract as `0x${string}`,
          data: prep.approve.data as Hex,
          chain: null,
        })) as Hex
        setTxHashes((s) => ({ ...s, approve: approveTx }))

        // ── 5. user signs fund ─────────────────────────────────
        setStep('signing-fund')
        const fundTx = (await walletClient.sendTransaction({
          account: userAddr,
          to: prep.contract as `0x${string}`,
          data: post.fund.data as Hex,
          chain: null,
        })) as Hex
        setTxHashes((s) => ({ ...s, fund: fundTx }))

        // ── 6. confirm ─────────────────────────────────────────
        setStep('confirming')
        const confirmRes = await fetch('/api/workflow/escrow/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflowId,
            approveTxHash: approveTx,
            fundTxHash: fundTx,
          }),
        })
        const confirmed = (await confirmRes.json().catch(() => ({}))) as {
          ok?: boolean
          jobId?: string
          fundTx?: string
          error?: string
          detail?: string
        }
        if (!confirmRes.ok || !confirmed.ok) {
          throw new Error(confirmed.detail || confirmed.error || `confirm ${confirmRes.status}`)
        }

        setResult({
          jobId: post.jobId,
          createTx,
          setBudgetTx: post.setBudgetTx,
          approveTx,
          fundTx,
        })
        setStep('done')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/user rejected|denied|cancelled/i.test(msg)) {
          setError('Bạn đã huỷ ký giao dịch')
        } else if (/insufficient.*funds|insufficient.*balance/i.test(msg)) {
          setError('Ví không đủ USDC hoặc gas. Hãy topup hoặc đợi pre-fund.')
        } else {
          setError(msg)
        }
        setStep('error')
      }
    },
    [wallets],
  )

  return { step, error, result, txHashes, reset, post }
}
