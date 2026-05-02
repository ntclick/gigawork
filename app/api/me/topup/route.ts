/**
 * /api/me/topup — on-chain USDC → credit conversion.
 *
 * Flow:
 *   1. Client calls USDC.transfer(TREASURY, amount) from their wallet → tx_hash
 *   2. Client POSTs { tx_hash } here
 *   3. Server fetches receipt + verifies:
 *        - status === 'success'
 *        - exactly one Transfer log on USDC contract
 *        - log.from === current user's wallet
 *        - log.to === USDC_TREASURY_ADDRESS
 *   4. Server decodes the Transfer value, converts to credits
 *      (TOPUP_RATE_CREDITS_PER_USDC = 100 → 1 USDC = 100 credit)
 *   5. grantCredits() inserts a ledger row with the tx_hash; UNIQUE constraint
 *      catches replays and surfaces as 409 DuplicateTopupError.
 *
 * GET returns current rate + treasury address so the client can render the
 * top-up form without env-var leaks beyond NEXT_PUBLIC_*.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { decodeEventLog, getAddress, parseAbi, type Hex } from 'viem'

import { getCurrentUser } from '@/lib/auth/session'
import { publicClient, explorerTxUrl } from '@/lib/chain/client'
import { DuplicateTopupError, grantCredits } from '@/lib/credits/service'

const TREASURY = (process.env.USDC_TREASURY_ADDRESS ??
  process.env.NEXT_PUBLIC_USDC_TREASURY ??
  '') as `0x${string}`

const USDC = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as `0x${string}`

const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')

export const TOPUP_RATE = Number(process.env.TOPUP_RATE_CREDITS_PER_USDC ?? '100')

const erc20Abi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])

const Body = z.object({
  tx_hash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/u, 'tx_hash must be 0x + 64 hex chars'),
})

function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export async function POST(req: Request) {
  if (!TREASURY) {
    return NextResponse.json(
      { error: 'USDC_TREASURY_ADDRESS not configured on server' },
      { status: 500 },
    )
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }
  const txHash = parsed.data.tx_hash as Hex

  const u = await getCurrentUser()

  // Fetch receipt — wait up to 30s for the tx to be mined
  let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
      timeout: 30_000,
    })
  } catch (e) {
    return NextResponse.json(
      {
        error: 'tx not mined within 30s',
        hint: 'Check explorer and retry once confirmed',
        tx: explorerTxUrl(txHash),
      },
      { status: 408 },
    )
  }

  if (receipt.status !== 'success') {
    return NextResponse.json(
      { error: 'tx reverted on-chain', tx: explorerTxUrl(txHash) },
      { status: 400 },
    )
  }

  // Decode all Transfer logs originating from the USDC contract. We
  // accept exactly ONE (rejects multi-hop, sandwich, and any oddities).
  type T = { from: `0x${string}`; to: `0x${string}`; value: bigint }
  const transfers: T[] = []
  for (const log of receipt.logs) {
    if (!eq(log.address, USDC)) continue
    try {
      const parsedEv = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics,
      })
      if (parsedEv.eventName === 'Transfer') {
        transfers.push(parsedEv.args as T)
      }
    } catch {
      /* not a Transfer event — skip */
    }
  }

  if (transfers.length === 0) {
    return NextResponse.json(
      {
        error: 'No USDC Transfer event found in this tx',
        usdc: USDC,
        tx: explorerTxUrl(txHash),
      },
      { status: 400 },
    )
  }
  if (transfers.length > 1) {
    return NextResponse.json(
      {
        error: 'Multiple USDC Transfer events in tx; ambiguous',
        count: transfers.length,
        tx: explorerTxUrl(txHash),
      },
      { status: 400 },
    )
  }

  const [t] = transfers
  if (!eq(t.from, u.wallet)) {
    return NextResponse.json(
      {
        error: 'Transfer.from does not match your wallet',
        expected: u.wallet,
        got: getAddress(t.from),
      },
      { status: 400 },
    )
  }
  if (!eq(t.to, TREASURY)) {
    return NextResponse.json(
      {
        error: 'Transfer.to is not the treasury',
        expected: getAddress(TREASURY),
        got: getAddress(t.to),
      },
      { status: 400 },
    )
  }

  // Convert raw USDC (6 decimals) → credits.
  //   credits = floor(value * RATE / 10^6)
  // Reject < 1 credit (i.e., dust) so we don't leave funds stranded.
  const divisor = BigInt(10) ** BigInt(USDC_DECIMALS)
  const credits = Number((t.value * BigInt(TOPUP_RATE)) / divisor)

  if (!Number.isFinite(credits) || credits <= 0) {
    return NextResponse.json(
      { error: 'tx value too small (would credit 0)', value: t.value.toString() },
      { status: 400 },
    )
  }

  try {
    const { balance } = await grantCredits({
      userId: u.id,
      amount: credits,
      reason: 'topup_onchain',
      txHash,
    })
    return NextResponse.json({
      ok: true,
      granted: credits,
      balance,
      txHash,
      explorer: explorerTxUrl(txHash),
      usdcAmount: Number(t.value) / 10 ** USDC_DECIMALS,
      rate: TOPUP_RATE,
    })
  } catch (e) {
    if (e instanceof DuplicateTopupError) {
      return NextResponse.json(
        {
          error: 'This tx has already been claimed',
          txHash,
          tx: explorerTxUrl(txHash),
        },
        { status: 409 },
      )
    }
    throw e
  }
}

export async function GET() {
  try {
    const u = await getCurrentUser()
    return NextResponse.json({
      rate: TOPUP_RATE,
      balance: u.credits,
      treasury: TREASURY,
      usdcAddress: USDC,
      usdcDecimals: USDC_DECIMALS,
    })
  } catch (e) {
    // Falls back to a usable response so the UI form stays renderable
    // even during DB blips. The user just sees `balance: 0` until the
    // next poll lands.
    console.error('[/api/me/topup GET] failed', e)
    return NextResponse.json(
      {
        rate: TOPUP_RATE,
        balance: 0,
        treasury: TREASURY,
        usdcAddress: USDC,
        usdcDecimals: USDC_DECIMALS,
        error: 'db_unavailable',
      },
      { status: 503 },
    )
  }
}
