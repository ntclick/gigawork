'use client'

/**
 * useSwap — token swaps signed by the CONNECTED wallet.
 *
 * Swapping used to run server-side: /api/appkit loaded a private key and
 * signed on the user's behalf. That is the wrong shape for this action.
 * A swap moves the user's own tokens between assets, so the user's wallet
 * should hold them and the user should approve each transaction — the
 * same way the identity mint and the vault top-up already work.
 *
 * Two routes, picked by the pair:
 *
 *   USDC ↔ USYC   Circle's Teller contract. Plain ERC-20 approve followed
 *                 by deposit()/redeem(), so it is written directly with
 *                 viem against the wallet's provider.
 *
 *   everything    Circle App-Kit, driven through
 *   else          `createViemAdapterFromProvider` — the browser adapter,
 *                 not the private-key one. Same SDK the server used, fed
 *                 an EIP-1193 provider instead of a key.
 *
 * Decimals are read from each token contract rather than assumed. USDC and
 * USYC are both 6, but cirBTC is not, and hardcoding 6 would have silently
 * mis-scaled those amounts by two orders of magnitude.
 */
import { useCallback, useRef, useState } from 'react'
import { createPublicClient, createWalletClient, custom, http, parseUnits, type Hex } from 'viem'

import { arcTestnet, ARC_CHAIN_ID } from '@/lib/chain/arcTestnet'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'

export type SwapStage = 'idle' | 'approving' | 'signing' | 'confirming' | 'done' | 'error'

export interface SwapResult {
  txHash: string | null
  approvalTx: string | null
}

/** Arc Testnet addresses — mirrors the CONTRACTS map in /api/appkit. */
const ADDR = {
  USDC: '0x3600000000000000000000000000000000000000',
  USYC: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C',
  EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
  TELLER: '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A',
} as const

export type SwapToken = 'USDC' | 'USYC' | 'EURC' | 'cirBTC'

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

const TELLER_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_assets', type: 'uint256' },
      { name: '_receiver', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'redeem',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_shares', type: 'uint256' },
      { name: '_receiver', type: 'address' },
      { name: '_account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const isTellerPair = (a: SwapToken, b: SwapToken) => a === 'USYC' || b === 'USYC'

export function useSwap(onStage?: (s: SwapStage, detail?: string) => void) {
  const activeWallet = useActiveWallet()
  const [stage, setStage] = useState<SwapStage>('idle')
  const busyRef = useRef(false)

  const emit = useCallback(
    (s: SwapStage, detail?: string) => {
      setStage(s)
      onStage?.(s, detail)
    },
    [onStage],
  )

  const swap = useCallback(
    async (tokenIn: SwapToken, tokenOut: SwapToken, amount: string): Promise<SwapResult> => {
      if (busyRef.current) throw new Error('a swap is already in progress')
      const wallet = activeWallet
      if (!wallet) throw new Error('connect a wallet first')
      if (tokenIn === tokenOut) throw new Error('pick two different tokens')

      busyRef.current = true
      try {
        // OKX rejects silently on the wrong chain; a no-op for embedded wallets.
        await wallet.switchChain(ARC_CHAIN_ID).catch(() => {})
        const provider = await wallet.getEthereumProvider()
        const account = wallet.address as `0x${string}`

        const publicClient = createPublicClient({ chain: arcTestnet, transport: http() })
        const walletClient = createWalletClient({ chain: arcTestnet, transport: custom(provider) })

        const inAddr = ADDR[tokenIn] as `0x${string}`
        const decimals = (await publicClient.readContract({
          address: inAddr,
          abi: ERC20_ABI,
          functionName: 'decimals',
        })) as number
        const amountWei = parseUnits(amount, decimals)

        let approvalTx: string | null = null

        if (isTellerPair(tokenIn, tokenOut)) {
          // ── Teller path: approve, then deposit or redeem ──
          const allowance = (await publicClient.readContract({
            address: inAddr,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [account, ADDR.TELLER as `0x${string}`],
          })) as bigint

          if (allowance < amountWei) {
            emit('approving')
            const tx = await walletClient.writeContract({
              account,
              address: inAddr,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [ADDR.TELLER as `0x${string}`, amountWei],
            })
            approvalTx = tx
            await publicClient.waitForTransactionReceipt({ hash: tx })
          }

          // Preflight. USYC is a permissioned RWA token: the Teller
          // rejects callers outside its allow-list with a bare custom
          // error (0x7f63bd0f — verified against a wallet holding ample
          // USDC with allowance already granted). Without this check the
          // user gets a wallet popup, signs, pays gas, and the tx reverts
          // on-chain for nothing. Simulating first costs nothing and
          // catches any other revert reason the same way.
          const teller = ADDR.TELLER as `0x${string}`
          const subscribing = tokenOut === 'USYC'

          try {
            if (subscribing) {
              await publicClient.simulateContract({
                account,
                address: teller,
                abi: TELLER_ABI,
                functionName: 'deposit',
                args: [amountWei, account],
              })
            } else {
              await publicClient.simulateContract({
                account,
                address: teller,
                abi: TELLER_ABI,
                functionName: 'redeem',
                args: [amountWei, account, account],
              })
            }
          } catch (simErr) {
            const raw = simErr instanceof Error ? simErr.message : String(simErr)
            throw new Error(
              `This swap would fail on-chain, so it was not submitted — no gas spent. ` +
                `USYC is a permissioned token and the Teller only accepts allow-listed ` +
                `wallets, which is the usual cause. (${raw.slice(0, 120)})`,
            )
          }

          emit('signing')
          const hash = subscribing
            ? await walletClient.writeContract({
                account,
                address: teller,
                abi: TELLER_ABI,
                functionName: 'deposit',
                args: [amountWei, account],
              })
            : await walletClient.writeContract({
                account,
                address: teller,
                abi: TELLER_ABI,
                functionName: 'redeem',
                args: [amountWei, account, account],
              })

          emit('confirming', hash)
          await publicClient.waitForTransactionReceipt({ hash: hash as Hex })
          emit('done')
          return { txHash: hash, approvalTx }
        }

        // ── App-Kit path, driven by the wallet's provider ──
        const kitKey = await fetch('/api/appkit')
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => j?.kitKey as string | undefined)
        if (!kitKey) throw new Error('swap router is not configured on this deployment')

        const [{ AppKit }, { createViemAdapterFromProvider }] = await Promise.all([
          import('@circle-fin/app-kit'),
          import('@circle-fin/adapter-viem-v2'),
        ])

        emit('signing')
        // Privy and Circle each ship their own EIP-1193 typing; they differ
        // only in how the `on` overloads are generic-ed, and are the same
        // object at runtime. Cast at this boundary rather than loosening
        // either side's types.
        // Returns a Promise — awaiting it matters, an unawaited adapter is
        // rejected by kit.swap() at runtime with an opaque shape error.
        const adapter = await createViemAdapterFromProvider({
          provider: provider as unknown as Parameters<
            typeof createViemAdapterFromProvider
          >[0]['provider'],
        })
        const kit = new AppKit()
        const result = (await kit.swap({
          from: { adapter, chain: 'Arc_Testnet' },
          tokenIn: ADDR[tokenIn],
          tokenOut: ADDR[tokenOut],
          amountIn: amount,
          config: { kitKey, slippageBps: 100 },
        } as Parameters<typeof kit.swap>[0])) as { txHash?: string }

        emit('done')
        return { txHash: result.txHash ?? null, approvalTx }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        emit('error', /user rejected|denied/i.test(msg) ? 'signature cancelled' : msg)
        throw e
      } finally {
        busyRef.current = false
      }
    },
    [activeWallet, emit],
  )

  return { swap, stage, connected: !!activeWallet }
}
