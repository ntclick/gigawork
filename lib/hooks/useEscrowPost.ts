'use client'

/**
 * useEscrowPost — drives the user-as-client ERC-8183 lifecycle from the
 * frontend using a single native USDC transfer payment transaction.
 *
 * State machine:
 *   idle
 *   → preparing       : POST /prepare to fetch Admin address & budget amount
 *   → signing-fund    : Privy popup — user signs a single native USDC transfer
 *   → confirming      : POST /confirm to verify native transfer and run EIP-8183 escrow in the background
 *   → done | error
 *
 * Idempotent: if /prepare returns `already: true`, hook short-circuits to done.
 */
import { useWallets } from '@privy-io/react-auth'
import { useCallback, useState } from 'react'
import { createWalletClient, custom, parseUnits, type Hex } from 'viem'
import { arcTestnet, ARC_CHAIN_ID } from '@/lib/chain/arcTestnet'

export type EscrowStep =
  | 'idle'
  | 'preparing'
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
          budgetUsdc?: string
          adminAddress?: string
          jobId?: string
          createTx?: string
          setBudgetTx?: string
          approveTx?: string
          fundTx?: string
          error?: string
          detail?: string
        }
        if (!prepRes.ok) {
          throw new Error(prep.detail || prep.error || `prepare ${prepRes.status}`)
        }

        if (prep.already && prep.fundTx) {
          setTxHashes({
            create: (prep.createTx || '0x0') as Hex,
            approve: (prep.approveTx || '0x0') as Hex,
            fund: (prep.fundTx || '0x0') as Hex,
          })
          setResult({
            jobId: prep.jobId!,
            createTx: (prep.createTx || '0x0') as Hex,
            setBudgetTx: (prep.setBudgetTx || '0x0') as Hex,
            approveTx: (prep.approveTx || '0x0') as Hex,
            fundTx: (prep.fundTx || '0x0') as Hex,
          })
          setStep('done')
          return
        }

        if (!prep.adminAddress || !prep.budgetUsdc) {
          throw new Error('prepare returned incomplete native payment bundle')
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
        const walletClient = createWalletClient({ chain: arcTestnet, transport: custom(provider) })
        const userAddr = wallet.address as `0x${string}`

        // ── 2. User signs a single Native USDC Transfer ───────
        setStep('signing-fund')
        const nativeUsdcValue = parseUnits(prep.budgetUsdc, 18) // Native USDC uses 18 decimals on Arc L1

        const txHash = (await walletClient.sendTransaction({
          account: userAddr,
          to: prep.adminAddress as `0x${string}`,
          value: nativeUsdcValue,
        })) as Hex

        setTxHashes((s) => ({ ...s, fund: txHash }))

        // ── 3. Confirm Native Payment & Backend Escrow ────────
        setStep('confirming')
        const confirmRes = await fetch('/api/workflow/escrow/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflowId,
            paymentTxHash: txHash,
          }),
        })
        const confirmed = (await confirmRes.json().catch(() => ({}))) as {
          ok?: boolean
          jobId?: string
          createTx?: string
          setBudgetTx?: string
          approveTx?: string
          fundTx?: string
          error?: string
          detail?: string
          hint?: string
          txHash?: string
        }
        if (!confirmRes.ok || !confirmed.ok) {
          throw new Error(normalizeEscrowError(confirmed.detail || confirmed.error || `confirm ${confirmRes.status}`, confirmed.hint, confirmed.txHash))
        }

        setTxHashes({
          create: (confirmed.createTx || '0x0') as Hex,
          approve: (confirmed.approveTx || '0x0') as Hex,
          fund: (confirmed.fundTx || '0x0') as Hex,
        })

        setResult({
          jobId: confirmed.jobId!,
          createTx: (confirmed.createTx || '0x0') as Hex,
          setBudgetTx: (confirmed.setBudgetTx || '0x0') as Hex,
          approveTx: (confirmed.approveTx || '0x0') as Hex,
          fundTx: (confirmed.fundTx || '0x0') as Hex,
        })
        setStep('done')
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const userRejected = /user rejected|denied|cancelled/i.test(msg)
        const pendingTx = /still pending|pending on Arc|not mined yet/i.test(msg)
        setStep(pendingTx ? 'confirming' : 'error')
        if (userRejected) {
          setError('Transaction signature cancelled. Click "Continue" to try again.')
          throw new Error('Transaction signature cancelled by user')
        } else if (/insufficient.*funds|insufficient.*balance/i.test(msg)) {
          setError('Insufficient USDC or gas in wallet. Please top up or wait for pre-funding.')
          throw new Error('Insufficient USDC or gas in wallet. Please top up or wait for pre-funding.')
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

function normalizeEscrowError(detail: string, hint?: string, txHash?: string) {
  const hash = txHash ?? detail.match(/0x[a-fA-F0-9]{64}/)?.[0]
  if (/timed out while waiting for transaction/i.test(detail)) {
    const target = hash ? ` ${hash}` : ''
    return `${hint ?? 'Transaction is still pending.'}${target}`
  }
  return hint ? `${detail}. ${hint}` : detail
}
