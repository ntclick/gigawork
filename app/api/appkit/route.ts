/**
 * /api/appkit — server-side proxy for Arc App-Kit bridge & swap.
 *
 * Actions:
 *   { action: 'bridge', amount, fromChain?, speed? }
 *   { action: 'swap', amount, tokenIn, tokenOut }
 *   { action: 'estimateSwap', amount, tokenIn, tokenOut }
 *   { action: 'estimateBridge', amount, fromChain?, toChain?, speed? }
 */
import { NextResponse } from 'next/server'
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { getCurrentUser, AuthRequiredError } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// Module-level cache for heavy dynamic imports to optimize API response speed
let cachedAppKit: any = null
let cachedAdapter: any = null

async function getAppKit() {
  if (!cachedAppKit) {
    const mod = await import('@circle-fin/app-kit')
    cachedAppKit = mod.AppKit
  }
  return cachedAppKit
}

async function getAdapter() {
  if (!cachedAdapter) {
    const mod = await import('@circle-fin/adapter-viem-v2')
    cachedAdapter = mod.createViemAdapterFromPrivateKey
  }
  return cachedAdapter
}

// ── Arc Testnet chain definition ────────────────────────────────
// Use shared definition (chain id 5042002, USDC native gas).
// See lib/chain/arcTestnet.ts + AGENTS.md §1.
import { arcTestnet } from '@/lib/chain/arcTestnet'

// ── Contract addresses on Arc Testnet ───────────────────────────
const CONTRACTS = {
  USDC:    '0x3600000000000000000000000000000000000000' as `0x${string}`,
  USYC:    '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C' as `0x${string}`,
  EURC:    '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as `0x${string}`,
  TELLER:  '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A' as `0x${string}`,
  ACCOUNT_MANAGER: '0xcc205224862c7641930c87679e98999d23c26113' as `0x${string}`,
  cirBTC:  '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' as `0x${string}`,
} as const

// ── ABIs ────────────────────────────────────────────────────────
const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint8' }] },
]

const TELLER_ABI = [
  // deposit(uint256 _assets, address _receiver) → uint256 (USDC → USYC)
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: '_assets', type: 'uint256' },
      { name: '_receiver', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }] },
  // redeem(uint256 _shares, address _receiver, address _account) → uint256 (USYC → USDC)
  { name: 'redeem', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: '_shares', type: 'uint256' },
      { name: '_receiver', type: 'address' },
      { name: '_account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }] },
]

// ── Token symbol → address mapping ─────────────────────────────
const TOKEN_MAP: Record<string, `0x${string}`> = {
  USDC: CONTRACTS.USDC,
  USYC: CONTRACTS.USYC,
  EURC: CONTRACTS.EURC,
  cirBTC: CONTRACTS.cirBTC,
}

export async function GET() {
  try {
    await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  const kitKey = process.env.CIRCLE_KIT_KEY ?? process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY ?? ''
  return NextResponse.json({ kitKey })
}

export async function POST(req: Request) {
  try {
    await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  const body = await req.json()
  const { action, amount, fromChain, toChain, tokenIn, tokenOut, speed } = body as {
    action: string
    amount: string
    fromChain?: string
    toChain?: string
    tokenIn?: string
    tokenOut?: string
    speed?: 'FAST' | 'SLOW'
  }

  if (!action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  const pk = process.env.ADMIN_PRIVATE_KEY
  if (!pk) {
    return NextResponse.json({ error: 'ADMIN_PRIVATE_KEY not configured' }, { status: 500 })
  }

  const kitKey = process.env.CIRCLE_KIT_KEY ?? ''

  // SDK sometimes returns {amount, token} objects instead of plain strings
  const normalizeAmount = (v: unknown): string | null => {
    if (v == null) return null
    if (typeof v === 'string' || typeof v === 'number') return String(v)
    if (typeof v === 'object' && 'amount' in (v as any)) return String((v as any).amount)
    return null
  }

  // Check if this swap involves USYC (needs Teller contract)
  const isUSYCSwap = (tIn?: string, tOut?: string) =>
    tIn === 'USYC' || tOut === 'USYC'

  try {
    // ── USYC SWAP via Teller ────────────────────────────────
    if ((action === 'swap' || action === 'estimateSwap') && isUSYCSwap(tokenIn, tokenOut)) {
      if (!tokenIn || !tokenOut) {
        return NextResponse.json({ error: 'tokenIn and tokenOut required' }, { status: 400 })
      }
      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
      }

      const account = privateKeyToAccount(pk as `0x${string}`)
      const publicClient = createPublicClient({ chain: arcTestnet as any, transport: http() })
      const walletClient = createWalletClient({
        account,
        chain: arcTestnet as any,
        transport: http(),
      })

      const decimals = 6 // USDC and USYC both use 6 decimals
      const amountWei = parseUnits(amount, decimals)

      // ── Estimate only ──
      if (action === 'estimateSwap') {
        // For USYC the rate is roughly 1:1 minus a small fee
        // The Teller contract handles the exact conversion
        return NextResponse.json({
          ok: true,
          action: 'estimateSwap',
          estimatedOutput: amount, // ~1:1 for stablecoins
          fees: [],
          note: 'USYC uses Teller contract (deposit/redeem). Actual output may vary slightly.',
        })
      }

      // ── Execute swap ──
      const explorer = 'https://testnet.arcscan.app'

      if (tokenIn === 'USDC' && tokenOut === 'USYC') {
        // Subscribe: USDC → USYC via Teller.deposit()
        // Step 1: Check & approve USDC for Teller
        const currentAllowance = await publicClient.readContract({
          address: CONTRACTS.USDC,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [account.address, CONTRACTS.TELLER],
        })

        if ((currentAllowance as bigint) < amountWei) {
          const approveTx = await walletClient.writeContract({
            address: CONTRACTS.USDC,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [CONTRACTS.TELLER, amountWei],
          } as any)
          await publicClient.waitForTransactionReceipt({ hash: approveTx })
        }

        // Step 2: Call Teller.deposit(amount, receiver)
        const depositTx = await walletClient.writeContract({
          address: CONTRACTS.TELLER,
          abi: TELLER_ABI,
          functionName: 'deposit',
          args: [amountWei, account.address],
        } as any)
        const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx })

        return NextResponse.json({
          ok: true,
          action: 'swap',
          tokenIn: 'USDC',
          tokenOut: 'USYC',
          amountIn: amount,
          amountOut: amount, // ~1:1
          txHash: receipt.transactionHash,
          explorerUrl: `${explorer}/tx/${receipt.transactionHash}`,
          method: 'teller-deposit',
        })

      } else if (tokenIn === 'USYC' && tokenOut === 'USDC') {
        // Redeem: USYC → USDC via Teller.redeem()
        // Step 1: Check & approve USYC for Teller
        const currentAllowance = await publicClient.readContract({
          address: CONTRACTS.USYC,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [account.address, CONTRACTS.TELLER],
        })

        if ((currentAllowance as bigint) < amountWei) {
          const approveTx = await walletClient.writeContract({
            address: CONTRACTS.USYC,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [CONTRACTS.TELLER, amountWei],
          } as any)
          await publicClient.waitForTransactionReceipt({ hash: approveTx })
        }

        // Step 2: Call Teller.redeem(shares, receiver, account)
        const redeemTx = await walletClient.writeContract({
          address: CONTRACTS.TELLER,
          abi: TELLER_ABI,
          functionName: 'redeem',
          args: [amountWei, account.address, account.address],
        } as any)
        const receipt = await publicClient.waitForTransactionReceipt({ hash: redeemTx })

        return NextResponse.json({
          ok: true,
          action: 'swap',
          tokenIn: 'USYC',
          tokenOut: 'USDC',
          amountIn: amount,
          amountOut: amount, // ~1:1
          txHash: receipt.transactionHash,
          explorerUrl: `${explorer}/tx/${receipt.transactionHash}`,
          method: 'teller-redeem',
        })

      } else {
        return NextResponse.json({
          error: `USYC can only be swapped with USDC. Pair ${tokenIn}/${tokenOut} is not supported.`,
        }, { status: 400 })
      }
    }

    // ── Non-USYC operations use App-Kit ─────────────────────
    const AppKitClass = await getAppKit()
    const createViemAdapter = await getAdapter()

    const kit = new AppKitClass()
    const adapter = createViemAdapter({ privateKey: pk })

    // ── BRIDGE ──────────────────────────────────────────────
    if (action === 'bridge') {
      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
      }
      const source = (fromChain ?? 'Ethereum_Sepolia') as string
      const dest = (toChain ?? 'Arc_Testnet') as string
      const result = await kit.bridge({
        from: { adapter, chain: source as any },
        to: { adapter, chain: dest as any, useForwarder: true } as any,
        amount,
        config: { transferSpeed: (speed ?? 'FAST') as any } as any,
      })

      if ((result as any).state === 'error') {
        const failedStep = (result as any).steps?.find((s: any) => s.state === 'error')
        throw new Error(failedStep?.errorMessage || 'Bridge failed')
      }

      return NextResponse.json({
        ok: true,
        action: 'bridge',
        amount,
        fromChain: source,
        toChain: dest,
        txHash: (result as any).steps?.find((s: any) => s.txHash)?.txHash ?? null,
        explorerUrl: (result as any).steps?.find((s: any) => s.explorerUrl)?.explorerUrl ?? null,
        steps: (result as any).steps?.map((s: any) => ({
          name: s.name,
          state: s.state,
          txHash: s.txHash,
          explorerUrl: s.explorerUrl,
        })) ?? [],
      })
    }

    // ── ESTIMATE BRIDGE ─────────────────────────────────────
    if (action === 'estimateBridge') {
      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
      }
      const source = (fromChain ?? 'Ethereum_Sepolia') as string
      const dest = (toChain ?? 'Arc_Testnet') as string
      const est = await kit.estimateBridge({
        from: { adapter, chain: source as any },
        to: { adapter, chain: dest as any, useForwarder: true } as any,
        amount,
        config: { transferSpeed: (speed ?? 'FAST') as any } as any,
      })

      let feeTotal = 0
      let providerFee = 0
      let forwarderFee = 0
      let kitFee = 0
      for (const f of (est as any).fees || []) {
        if (f.amount == null) continue
        const n = parseFloat(typeof f.amount === 'object' ? f.amount.amount : f.amount)
        if (isNaN(n)) continue
        feeTotal += n
        if (f.type === 'provider') providerFee += n
        else if (f.type === 'forwarder') forwarderFee += n
        else if (f.type === 'kit') kitFee += n
      }
      const amountIn = parseFloat(amount) || 0
      const amountReceived = Math.max(amountIn - feeTotal, 0)

      return NextResponse.json({
        ok: true,
        action: 'estimateBridge',
        feeTotal,
        providerFee,
        forwarderFee,
        kitFee,
        amountReceived,
        fees: (est as any).fees || [],
      })
    }

    // ── SWAP (USDC ↔ EURC via App-Kit) ──────────────────────
    if (action === 'swap') {
      if (!tokenIn || !tokenOut) {
        return NextResponse.json({ error: 'tokenIn and tokenOut required' }, { status: 400 })
      }
      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
      }
      if (!kitKey) {
        return NextResponse.json({ error: 'CIRCLE_KIT_KEY not configured' }, { status: 500 })
      }

      const resolvedTokenIn = TOKEN_MAP[tokenIn] ?? tokenIn
      const resolvedTokenOut = TOKEN_MAP[tokenOut] ?? tokenOut

      const result = await kit.swap({
        from: { adapter, chain: 'Arc_Testnet' as any },
        tokenIn: resolvedTokenIn as any,
        tokenOut: resolvedTokenOut as any,
        amountIn: amount,
        config: { kitKey, slippageBps: 100 },
      })
      return NextResponse.json({
        ok: true,
        action: 'swap',
        tokenIn,
        tokenOut,
        amountIn: amount,
        amountOut: normalizeAmount((result as any).amountOut),
        txHash: (result as any).txHash ?? null,
        explorerUrl: (result as any).explorerUrl ?? null,
        fees: (result as any).fees ?? [],
      })
    }

    // ── ESTIMATE SWAP (USDC ↔ EURC) ─────────────────────────
    if (action === 'estimateSwap') {
      if (!tokenIn || !tokenOut) {
        return NextResponse.json({ error: 'tokenIn and tokenOut required' }, { status: 400 })
      }
      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
      }
      if (!kitKey) {
        return NextResponse.json({ error: 'CIRCLE_KIT_KEY not configured' }, { status: 500 })
      }

      const resolvedTokenIn = TOKEN_MAP[tokenIn] ?? tokenIn
      const resolvedTokenOut = TOKEN_MAP[tokenOut] ?? tokenOut

      try {
        const est = await kit.estimateSwap({
          from: { adapter, chain: 'Arc_Testnet' as any },
          tokenIn: resolvedTokenIn as any,
          tokenOut: resolvedTokenOut as any,
          amountIn: amount,
          config: { kitKey },
        })
        return NextResponse.json({
          ok: true,
          action: 'estimateSwap',
          estimatedOutput: normalizeAmount((est as any).estimatedOutput) ?? normalizeAmount((est as any).amountOut),
          fees: (est as any).fees ?? [],
        })
      } catch (err: any) {
        const errMsg = err?.message || String(err)
        console.warn('[/api/appkit] estimateSwap App-Kit error, using stablecoin fallback:', errMsg)
        
        // Dynamic rates simulation to keep the UI rate calculation fully responsive even if Circle\'s route is missing
        let estimatedOutput = amount // 1:1 fallback
        if (tokenIn === 'USDC' && tokenOut === 'EURC') {
          estimatedOutput = String(Number(amount) * 0.92)
        } else if (tokenIn === 'EURC' && tokenOut === 'USDC') {
          estimatedOutput = String(Number(amount) * 1.08)
        } else if (tokenIn === 'USDC' && tokenOut === 'cirBTC') {
          estimatedOutput = String(Number(amount) * 0.000015)
        } else if (tokenIn === 'cirBTC' && tokenOut === 'USDC') {
          estimatedOutput = String(Number(amount) * 65000)
        }
        
        return NextResponse.json({
          ok: true,
          action: 'estimateSwap',
          estimatedOutput,
          fees: [
            { token: 'USDC', amount: '0.0002', type: 'provider' },
            { token: 'USDC', amount: '0.0221', type: 'gas' }
          ],
          note: 'Estimated via fallback due to Circle testnet route limitation.',
        })
      }
    }


    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[/api/appkit] error:', msg)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
