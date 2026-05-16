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
import { usePrivy, useSendTransaction } from '@privy-io/react-auth'

import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { useCallback, useState } from 'react'
import { createPublicClient, createWalletClient, custom, http, type Hex } from 'viem'

// Custom arcTestnet (USDC native gas, NOT ETH) — viem/chains version is
// wrong about nativeCurrency and breaks external wallet gas estimation.
// See lib/chain/arcTestnet.ts + AGENTS.md §1.
import { ARC_CHAIN_ID, arcTestnet } from '@/lib/chain/arcTestnet'

const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC || 'https://rpc.testnet.arc.network'

// Server-side post-create polling window. Arc Testnet RPC propagation
// lag can run 60-90s, so we wait up to 120s before giving up.
const POST_CREATE_POLL_ATTEMPTS = 80          // 80 * 1.0s = 80s total (faster polls)
const POST_CREATE_POLL_INTERVAL_MS = 1_000
const POST_CREATE_RESET_MISSING_AFTER_POLLS = 44  // only declare missing after 110s (8s buffer before total timeout)

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
  const activeWallet = useActiveWallet()
  const { user: privyUser } = usePrivy()
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

      const wallet = activeWallet
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

      // Pre-sync cookie to the wallet we're about to sign with. WalletPill
      // also does this on render, but its useEffect can lag behind a fresh
      // page mount or a recent account switch — escrow auto-fires 600ms
      // after mount, which is faster than the typical Privy hydrate cycle.
      // Sending privyId (stable DID from usePrivy) ensures the server
      // resolves to the right user row and bumps user.wallet so the
      // createJob signer check passes. Idempotent: same cookie → no-op.
      try {
        const privyId = privyUser?.id
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: wallet.address.toLowerCase(),
            ...(privyId ? { privyId } : {}),
          }),
        })
      } catch (e) {
        console.warn('[escrow] pre-sync auth failed (tolerating)', e)
      }

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

        // Per AGENTS.md canonical pattern:
        //  - Embedded (Privy email/social) → useSendTransaction hook. The
        //    viem-bridge has a known UserRejectedRequestError bug when
        //    sending through a custom(provider) transport for embedded
        //    wallets, so we go through Privy's native hook instead.
        //  - External (OKX, MetaMask, Rabby…) → viem walletClient with
        //    custom(provider) transport. Chain is set on the CLIENT, NOT
        //    on the tx params — passing `chain` into sendTransaction
        //    triggers a redundant wallet_switchEthereumChain that OKX
        //    silently fails. Gas/fees are auto-estimated by viem+wallet,
        //    matching scripts/onchain/full-flow-8183.ts which also passes
        //    no explicit gas.
        const walletClientType = (wallet as { walletClientType?: string }).walletClientType
        const isEmbedded = walletClientType === 'privy'

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

        const externalWalletClient = isEmbedded
          ? null
          : createWalletClient({ chain: arcTestnet, transport: custom(provider) })

        // PublicClient for explicit gas + fee estimation via Arc RPC.
        // External wallets on a custom chain with non-ETH native currency
        // (Arc → USDC) tend to estimate fee = 0 if we don't override.
        // We fetch maxFeePerGas + maxPriorityFeePerGas from the chain RPC
        // directly so the tx broadcast carries valid fee params and gets
        // included instead of stuck-pending. AGENTS.md §4.
        const estimateClient = createPublicClient({
          chain: arcTestnet,
          transport: http(ARC_RPC_URL, { batch: false }),
        })

        const signTx = async (args: { to: `0x${string}`; data: Hex }): Promise<Hex> => {
          console.log('[escrow] signTx →', { to: args.to, embedded: isEmbedded })

          // Embedded — Privy hook owns build+sign+broadcast.
          if (isEmbedded) {
            const result = await privySendTransaction(
              { to: args.to, data: args.data, chainId: ARC_CHAIN_ID },
              { address: userAddr },
            )
            console.log('[escrow] signTx ← hash', result.hash)
            return result.hash
          }

          // External — fetch gas + fees from Arc RPC, then pass tường minh.
          // NO `chain` in tx params (would trigger wallet_switchEthereumChain).
          const [gas, fees] = await Promise.all([
            estimateClient
              .estimateGas({ account: userAddr, to: args.to, data: args.data })
              .catch((err) => {
                console.warn('[escrow] estimateGas failed, using fallback', err)
                return 500_000n
              }),
            estimateClient
              .estimateFeesPerGas()
              .catch((err) => {
                console.warn('[escrow] estimateFeesPerGas failed, wallet will default', err)
                return null
              }),
          ])
          console.log('[escrow] gas params', {
            gas: gas.toString(),
            maxFeePerGas: fees?.maxFeePerGas?.toString(),
            maxPriorityFeePerGas: fees?.maxPriorityFeePerGas?.toString(),
          })

          const client = externalWalletClient!
          const hash = (await client.sendTransaction({
            account: userAddr,
            to: args.to,
            data: args.data,
            gas,
            ...(fees?.maxFeePerGas ? { maxFeePerGas: fees.maxFeePerGas } : {}),
            ...(fees?.maxPriorityFeePerGas
              ? { maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
              : {}),
          } as Parameters<typeof client.sendTransaction>[0])) as Hex
          console.log('[escrow] signTx ← hash', hash)
          return hash
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

          // Frontend waits for the receipt FIRST — same pattern as the
          // scripts/onchain reference script. The wallet broadcasts via
          // its own RPC; if we hand the hash to the server before it's
          // mined, the server's RPC may not have seen it yet (propagation
          // lag across nodes). Polling via the same Arc public RPC pool
          // here means viem keeps retrying until the receipt appears on
          // any of the load-balanced nodes — the same mechanism that
          // makes the reference script reliable.
          try {
            await waitForCreateReceipt(createTx)
          } catch (e) {
            // If the local wait times out, fall through to the server poll
            // loop anyway — it has its own multi-RPC fallback and a longer
            // window. Log so we can diagnose stuck-tx vs. propagation lag.
            console.warn('[escrow] frontend waitForTransactionReceipt failed, falling back to server poll', e)
          }
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
    [activeWallet, privySendTransaction, privyUser?.id],
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
 * Wait for a tx receipt — exact pattern from scripts/onchain/full-flow-8183.ts:
 *   const pub = createPublicClient({ chain: arcTestnet, transport: http() })
 *   const rcpt = await pub.waitForTransactionReceipt({ hash })
 *
 * `transport: http()` with no URL uses arcTestnet's default rpcUrls (the
 * three official Arc public RPCs), which viem load-balances internally.
 * waitForTransactionReceipt polls until the receipt appears or times out.
 */
async function waitForCreateReceipt(hash: Hex): Promise<void> {
  const pub = createPublicClient({ chain: arcTestnet, transport: http() })
  const rcpt = await pub.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
    pollingInterval: 1_000,
  })
  if (rcpt.status !== 'success') {
    throw new Error(`createJob tx ${hash} reverted`)
  }
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
