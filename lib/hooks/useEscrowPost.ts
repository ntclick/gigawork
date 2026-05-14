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
import { useSendTransaction, useWallets } from '@privy-io/react-auth'
import { useCallback, useState } from 'react'
import { createWalletClient, custom, defineChain, type Hex } from 'viem'

const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '5042002')
const ARC_RPC_URLS = [
  'https://rpc.testnet.arc.network',
  process.env.NEXT_PUBLIC_ARC_RPC,
  'https://rpc.drpc.testnet.arc.network',
].filter((url, index, arr): url is string => !!url && arr.indexOf(url) === index)
// Arc Testnet RPC propagation lag: a tx signed via the user's wallet can
// take 20-40s to appear in the public RPC's mempool view even though the
// wallet has already broadcast it. The previous threshold of 6 polls (15s)
// was tripping aggressive "create_tx_not_found" resets that wiped the
// persisted tx hash and forced the user to re-sign — Privy then often
// rejected the second popup as rapid back-to-back signs.
const POST_CREATE_POLL_ATTEMPTS = 36          // 36 * 2.5s = 90s total
const POST_CREATE_POLL_INTERVAL_MS = 2_500
const POST_CREATE_RESET_MISSING_AFTER_POLLS = 24  // only declare missing after 60s+

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ARC_RPC_URLS } },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app',
    },
  },
  testnet: true,
})

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

type PostCreateResponse = {
  ok?: boolean
  jobId?: string
  setBudgetTx?: Hex
  approveTx?: Hex
  fund?: { data: string }
  error?: string
  detail?: string
  hint?: string
  txHash?: string
  recoverable?: boolean
  resetCreateTx?: boolean
  txVisible?: boolean
}

export function useEscrowPost(): UseEscrowPostReturn {
  const { wallets } = useWallets()
  const { sendTransaction: privySendTransaction } = useSendTransaction()
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
      console.log('[escrow] wallet meta', {
        address: wallet.address,
        walletClientType: (wallet as { walletClientType?: string }).walletClientType,
        connectorType: (wallet as { connectorType?: string }).connectorType,
        chainId: (wallet as { chainId?: string }).chainId,
      })

      try {
        // Single attempt. Earlier code retried up to 3 times within the
        // same post() call when post-create returned create_tx_not_found,
        // but each retry triggers ANOTHER wallet popup — Privy then
        // rejects rapid back-to-back signing as "user denied". Single
        // attempt + a clear error message lets the user retry by clicking
        // Continue funding again, which goes through prepare's idempotent
        // resume path (no extra sign needed if createTx is persisted).
        for (let attempt = 0; attempt < 1; attempt++) {
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
          expiredAt?: string
          description?: string
          provider?: string
          evaluator?: string
          hook?: string
          createJob?: { to: string; data: string }
          approve?: { to: string; data: string } | null
          approvalRequired?: boolean
          approvalAmount?: string
          allowance?: string
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
        const approvalAlreadySatisfied = prep.approveTx === '0x0' || prep.approvalRequired === false
        if (
          (!prep.already && (!prep.createJob || !prep.provider || !prep.evaluator || !prep.expiredAt || !prep.description || !prep.hook)) ||
          (!prep.approve && !approvalAlreadySatisfied) ||
          !prep.budget ||
          !prep.contract ||
          !prep.usdcContract
        ) {
          throw new Error('prepare returned incomplete bundle')
        }

        // Detect wallet kind. Privy embedded wallet (login via email/social,
        // walletClientType === 'privy') has a known viem-bridge bug where
        // `walletClient.sendTransaction` through the proxy provider returns
        // UserRejectedRequestError even when the user clicks Sign (the popup
        // closes before the SDK relays the result back). The native
        // `useSendTransaction` hook from @privy-io/react-auth avoids the
        // proxy entirely and works reliably for embedded wallets.
        const walletClientType = (wallet as { walletClientType?: string }).walletClientType
        const isEmbedded = walletClientType === 'privy'

        // Only attempt switchChain for external wallets — embedded wallets
        // accept chainId per tx via the Privy hook and don't need a separate
        // switch step.
        if (!isEmbedded) {
          try {
            await wallet.switchChain(ARC_CHAIN_ID)
          } catch (e) {
            console.warn('[escrow] switchChain failed (tolerating)', e)
          }
          await new Promise((r) => setTimeout(r, 250))
        }

        const provider = await wallet.getEthereumProvider()
        const userAddr = wallet.address as `0x${string}`

        // Build viem walletClient for the external-wallet path. Embedded
        // path bypasses this and uses privySendTransaction directly.
        const walletClient = isEmbedded
          ? null
          : createWalletClient({ chain: arcTestnet, transport: custom(provider) })

        // Helper: pick the right sign path per wallet kind.
        const signTx = async (args: { to: `0x${string}`; data: Hex }): Promise<Hex> => {
          if (isEmbedded) {
            const result = await privySendTransaction(
              { to: args.to, data: args.data, chainId: ARC_CHAIN_ID },
              { address: userAddr },
            )
            return result.hash
          }
          return (await walletClient!.sendTransaction({
            account: userAddr,
            to: args.to,
            data: args.data,
            chain: arcTestnet,
          })) as Hex
        }

        // ── 2. user signs createJob, or resume existing create tx ─────
        let createTx = prep.createTx as Hex | undefined
        let createTxFresh = false
        if (!createTx) {
          setStep('signing-create')
          createTx = await signTx({
            to: prep.createJob!.to as `0x${string}`,
            data: prep.createJob!.data as Hex,
          })
          createTxFresh = true
          setTxHashes((s) => ({ ...s, create: createTx }))
          await trackEscrowTx(workflowId, { createJobTxHash: createTx })
        }

        // ── 3. backend provider signs setBudget after createJob lands ──
        setStep('posting-create')
        let postStatus = 0
        let postOk = false
        let post: PostCreateResponse = {}
        for (let poll = 0; poll < POST_CREATE_POLL_ATTEMPTS; poll++) {
          const dropMissingTx = createTxFresh && poll >= POST_CREATE_RESET_MISSING_AFTER_POLLS
          const postRes = await fetch('/api/workflow/escrow/post-create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workflowId, createJobTxHash: createTx, budget: prep.budget, createTxFresh, dropMissingTx }),
          })
          postStatus = postRes.status
          postOk = postRes.ok
          post = (await postRes.json().catch(() => ({}))) as PostCreateResponse

          if (post.error !== 'create_tx_pending') break
          if (poll < POST_CREATE_POLL_ATTEMPTS - 1) {
            await delay(POST_CREATE_POLL_INTERVAL_MS)
          }
        }
        if (post.error === 'create_tx_pending') {
          throw new Error(normalizeEscrowError(post.detail || 'Create job transaction is still pending confirmation', post.hint, post.txHash))
        }
        if (post.error === 'create_tx_not_found' && post.resetCreateTx) {
          // Do NOT auto-retry-sign within the same post() call. Privy
          // embedded wallet often rejects rapid back-to-back signing
          // requests as "user denied" — the user thinks they signed but
          // sees an error. Surface the error so the user can re-click
          // Continue funding from a clean state. The persisted createTx
          // in DB is preserved unless dropMissingTx fired, so resume is
          // idempotent on the next click.
          setTxHashes({})
          setStep('idle')
          throw new Error(post.detail || 'Create job transaction not visible on Arc RPC. Please retry — the wallet hash will be reused.')
        }
        if (!postOk || !post.jobId || !post.setBudgetTx || !post.fund?.data) {
          throw new Error(normalizeEscrowError(post.detail || post.error || `post-create ${postStatus}`, post.hint, post.txHash))
        }

        // ── 4. user signs approve after setBudget is ready ───────
        let approveTx = (prep.approveTx ?? post.approveTx) as Hex | undefined
        if (!approveTx) {
          if (!prep.approve) {
            throw new Error('prepare returned no approve calldata')
          }
          setStep('signing-approve')
          approveTx = await signTx({
            to: prep.approve.to as `0x${string}`,
            data: prep.approve.data as Hex,
          })
          setTxHashes((s) => ({ ...s, approve: approveTx }))
          await trackEscrowTx(workflowId, { approveTxHash: approveTx })
        }

        // ── 5. user signs fund ─────────────────────────────────
        let fundTx = prep.fundTx as Hex | undefined
        if (!fundTx) {
          setStep('signing-fund')
          fundTx = await signTx({
            to: prep.contract as `0x${string}`,
            data: post.fund.data as Hex,
          })
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
        return
        }
        throw new Error('Escrow funding could not recover stale create transaction')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[escrow] raw error caught:', e, '\nmessage:', msg, '\nstack:', e instanceof Error ? e.stack : undefined)
        const staleTx = /no longer visible|stale hashes were cleared|sign again/i.test(msg)
        const pendingTx = /still pending|pending on Arc|not mined yet/i.test(msg)
        setStep(pendingTx ? 'posting-create' : staleTx ? 'idle' : 'error')
        if (staleTx) setTxHashes({})
        if (isUserRejection(e)) {
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
    [wallets, privySendTransaction],
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Detect real user-rejection from wallet errors. Privy / viem wrap errors so we
 * walk `cause` chain checking EIP-1193 code 4001 + the viem error class name.
 * Only fall back to message regex with very specific phrases — a loose pattern
 * like `/rejected/i` matches RPC errors, chain mismatch, and Privy session
 * issues and would mis-label non-cancel failures as user cancel.
 */
function isUserRejection(err: unknown): boolean {
  let cur: unknown = err
  for (let depth = 0; depth < 6 && cur; depth++) {
    const e = cur as { code?: unknown; name?: string; shortMessage?: string; message?: string; cause?: unknown }
    if (e.code === 4001 || e.code === 'ACTION_REJECTED') return true
    if (e.name === 'UserRejectedRequestError') return true
    const msg = `${e.shortMessage ?? ''} ${e.message ?? ''}`
    if (/User rejected the request|User denied (transaction|message) signature|action_rejected/i.test(msg)) {
      return true
    }
    cur = e.cause
  }
  return false
}
