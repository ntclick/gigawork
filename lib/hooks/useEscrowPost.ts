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
 *                       returns fund calldata once createJob is confirmed
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
        throw new Error('No wallet connected')
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
          approveTx?: string
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
        if (prep.createTx) setTxHashes((s) => ({ ...s, create: prep.createTx as Hex }))
        if (prep.approveTx) setTxHashes((s) => ({ ...s, approve: prep.approveTx as Hex }))
        if (prep.fundTx) setTxHashes((s) => ({ ...s, fund: prep.fundTx as Hex }))
        if (prep.already && prep.fundTx) {
          setStep('done')
          return
        }
        if ((!prep.already && !prep.createJob) || !prep.approve || !prep.budget || !prep.contract) {
          throw new Error('prepare returned incomplete bundle')
        }

        // Switch chain once up front. Privy embedded wallets noop if already correct.
        try {
          await wallet.switchChain(ARC_CHAIN_ID)
        } catch {
          /* tolerate */
        }
        const provider = await wallet.getEthereumProvider()
        const currentChain = await provider.request({ method: 'eth_chainId' }).catch(() => null)
        if (typeof currentChain === 'string' && Number.parseInt(currentChain, 16) !== ARC_CHAIN_ID) {
          throw new Error(`Wallet is on chain ${Number.parseInt(currentChain, 16)}, expected Arc Testnet ${ARC_CHAIN_ID}`)
        }
        const walletClient = createWalletClient({ transport: custom(provider) })
        const userAddr = wallet.address as `0x${string}`

        // ── 2. user signs createJob, or resume existing create tx ─────
        let createTx = prep.createTx as Hex | undefined
        let createTxFresh = false
        if (!createTx) {
          setStep('signing-create')
          createTx = (await walletClient.sendTransaction({
            account: userAddr,
            to: prep.createJob!.to as `0x${string}`,
            data: prep.createJob!.data as Hex,
            chain: null,
          })) as Hex
          createTxFresh = true
          setTxHashes((s) => ({ ...s, create: createTx }))
          await trackEscrowTx(workflowId, { createJobTxHash: createTx })
        }

        // ── 3. backend provider signs setBudget after createJob lands ──
        setStep('posting-create')
        const postRes = await fetch('/api/workflow/escrow/post-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId, createJobTxHash: createTx, budget: prep.budget, createTxFresh }),
        })
        const post = (await postRes.json().catch(() => ({}))) as {
          ok?: boolean
          jobId?: string
          setBudgetTx?: Hex
          approveTx?: Hex
          fund?: { data: string }
          error?: string
          detail?: string
          hint?: string
          txHash?: string
        }
        if (!postRes.ok || !post.jobId || !post.setBudgetTx || !post.fund?.data) {
          throw new Error(normalizeEscrowError(post.detail || post.error || `post-create ${postRes.status}`, post.hint, post.txHash))
        }

        // ── 4. user signs approve after setBudget is ready ───────
        let approveTx = (prep.approveTx ?? post.approveTx) as Hex | undefined
        if (!approveTx) {
          setStep('signing-approve')
          approveTx = (await walletClient.sendTransaction({
            account: userAddr,
            to: prep.usdcContract as `0x${string}`,
            data: prep.approve.data as Hex,
            chain: null,
          })) as Hex
          setTxHashes((s) => ({ ...s, approve: approveTx }))
          await trackEscrowTx(workflowId, { approveTxHash: approveTx })
        }

        // ── 5. user signs fund ─────────────────────────────────
        let fundTx = prep.fundTx as Hex | undefined
        if (!fundTx) {
          setStep('signing-fund')
          fundTx = (await walletClient.sendTransaction({
            account: userAddr,
            to: prep.contract as `0x${string}`,
            data: post.fund!.data as Hex,
            chain: null,
          })) as Hex
          setTxHashes((s) => ({ ...s, fund: fundTx }))
          await trackEscrowTx(workflowId, { fundTxHash: fundTx })
        }

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
          hint?: string
          txHash?: string
        }
        if (!confirmRes.ok || !confirmed.ok) {
          throw new Error(normalizeEscrowError(confirmed.detail || confirmed.error || `confirm ${confirmRes.status}`, confirmed.hint, confirmed.txHash))
        }

        setResult({
          jobId: post.jobId!,
          createTx,
          setBudgetTx: post.setBudgetTx!,
          approveTx,
          fundTx,
        })
        setStep('done')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const staleTx = /no longer visible|stale hashes were cleared|sign again/i.test(msg)
        const pendingTx = /still pending|pending on Arc|not mined yet/i.test(msg)
        setStep(pendingTx ? 'posting-create' : staleTx ? 'idle' : 'error')
        if (staleTx) setTxHashes({})
        if (/user rejected|denied|cancelled/i.test(msg)) {
          setError('Bạn đã huỷ ký giao dịch')
          throw new Error('Bạn đã huỷ ký giao dịch')
        } else if (/insufficient.*funds|insufficient.*balance/i.test(msg)) {
          setError('Ví không đủ USDC hoặc gas. Hãy topup hoặc đợi pre-fund.')
          throw new Error('Ví không đủ USDC hoặc gas. Hãy topup hoặc đợi pre-fund.')
        } else {
          setError(msg)
          throw new Error(msg)
        }
      }
    },
    [wallets],
  )

  return { step, error, result, txHashes, reset, post }
}

async function trackEscrowTx(
  workflowId: string,
  txs: { createJobTxHash?: Hex; approveTxHash?: Hex; fundTxHash?: Hex },
) {
  const res = await fetch('/api/workflow/escrow/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, ...txs }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `track escrow tx ${res.status}`)
  }
}

function normalizeEscrowError(detail: string, hint?: string, txHash?: string) {
  const hash = txHash ?? detail.match(/0x[a-fA-F0-9]{64}/)?.[0]
  if (/timed out while waiting for transaction/i.test(detail)) {
    const target = hash ? ` ${hash}` : ''
    return `${hint ?? 'Transaction is still pending.'}${target}`
  }
  return hint ? `${detail}. ${hint}` : detail
}
