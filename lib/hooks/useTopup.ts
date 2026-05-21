'use client'

/**
 * useTopup — drives the on-chain USDC.transfer → /api/me/topup → grant flow.
 *
 * The hook owns three pieces of state:
 *   - `step` : idle | signing | confirming | granting | done | error
 *     UI uses this to render a 3-dot stepper (sign → confirm → server verify).
 *   - `txHash` (set after wallet signs)
 *   - `result` (set after server verifies + grants)
 *
 * Flow:
 *   1. Switch wallet to Arc testnet (silent if already there)
 *   2. wallet.transfer USDC to TREASURY (real on-chain tx)
 *   3. Wait briefly for tx to propagate (poll once), then POST /api/me/topup
 *      with the tx_hash — server does the heavy lifting (waitForReceipt +
 *      Transfer-event verify + grant).
 *   4. Fire `gw:credits-changed` so MainHeader USDC pill + WalletPill credit
 *      pill refetch.
 */
import { useWallets } from '@privy-io/react-auth'
import { useCallback, useState } from 'react'
import { createPublicClient, createWalletClient, custom, encodeFunctionData, http, parseUnits, type Hex } from 'viem'
import { arcTestnet, ARC_CHAIN_ID } from '@/lib/chain/arcTestnet'

const USDC = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as `0x${string}`

const TREASURY = (process.env.NEXT_PUBLIC_USDC_TREASURY ?? '') as `0x${string}`

const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
})

// Minimal ERC-20 ABI for transfer().
const erc20TransferAbi = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

export type TopupStep = 'idle' | 'signing' | 'confirming' | 'granting' | 'done' | 'error'

export interface TopupResult {
  ok: true
  granted: number
  balance: number
  txHash: string
  explorer: string
  usdcAmount: number
  rate: number
}

export interface UseTopupReturn {
  step: TopupStep
  error: string | null
  txHash: Hex | null
  result: TopupResult | null
  reset: () => void
  topup: (usdcAmount: number) => Promise<void>
}

export function useTopup(): UseTopupReturn {
  const { wallets } = useWallets()
  const [step, setStep] = useState<TopupStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)
  const [result, setResult] = useState<TopupResult | null>(null)

  const reset = useCallback(() => {
    setStep('idle')
    setError(null)
    setTxHash(null)
    setResult(null)
  }, [])

  const topup = useCallback(
    async (usdcAmount: number) => {
      setError(null)
      setResult(null)

      if (!TREASURY) {
        setStep('error')
        setError('Treasury address is not configured (NEXT_PUBLIC_USDC_TREASURY)')
        return
      }
      if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) {
        setStep('error')
        setError('USDC amount must be greater than 0')
        return
      }

      const wallet = wallets[0]
      if (!wallet) {
        setStep('error')
        setError('No wallet connected')
        return
      }

      try {
        setStep('signing')
        // Switch to Arc Testnet — embedded wallets noop if already correct;
        // external wallets prompt the user.
        try {
          await wallet.switchChain(ARC_CHAIN_ID)
        } catch {
          /* already on chain or wallet ignored */
        }

        const provider = await wallet.getEthereumProvider()
        const walletClient = createWalletClient({ chain: arcTestnet, transport: custom(provider) })

        const value = parseUnits(String(usdcAmount), USDC_DECIMALS)
        const data = encodeFunctionData({
          abi: erc20TransferAbi,
          functionName: 'transfer',
          args: [TREASURY, value],
        })

        const txRequest = {
          account: wallet.address as `0x${string}`,
          to: USDC,
          data,
        }
        const gas = await publicClient.estimateGas(txRequest)
        const hash = (await walletClient.sendTransaction({
          ...txRequest,
          gas,
        })) as Hex
        setTxHash(hash)

        // Server waits for the receipt itself (waitForTransactionReceipt
        // with confirmations:1, 30s timeout). We just hand it the hash.
        setStep('confirming')

        // Optional small delay to let RPC propagate the tx — eliminates the
        // race where /api/me/topup fetches receipt before any node has it.
        await new Promise((r) => setTimeout(r, 1500))

        setStep('granting')
        const r = await fetch('/api/me/topup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tx_hash: hash }),
        })
        const j = (await r.json()) as TopupResult | { error: string }
        if (!r.ok || !('ok' in j)) {
          const msg = 'error' in j ? j.error : `HTTP ${r.status}`
          throw new Error(msg)
        }
        setResult(j)
        setStep('done')

        // Force USDC pill + credit pill to refresh
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gw:credits-changed'))
        }
      } catch (e) {
        setStep('error')
        const msg = e instanceof Error ? e.message : String(e)
        // User rejected wallet popup is benign — surface a friendly message.
        if (/user rejected|denied|cancelled/i.test(msg)) {
          setError('Transaction signature cancelled by user')
        } else {
          setError(msg)
        }
      }
    },
    [wallets],
  )

  return { step, error, txHash, result, reset, topup }
}
