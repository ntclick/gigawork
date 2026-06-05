/**
 * nanopayments.ts — Circle x402 Protocol + EIP-3009 USDC Payment Utilities
 *
 * Implements the HTTP-402 challenge/response flow for M2M Agent payments:
 *   1. Buyer Agent calls /api/agents/[skill] without payment → 402 + challenge
 *   2. Buyer signs EIP-3009 TransferWithAuthorization (gasless, off-chain)
 *   3. Buyer retries with X-PAYMENT header containing the signed authorization
 *   4. Server verifies signature cryptographically → returns 200 + result
 *   5. Signatures are batched for on-chain settlement via Circle Gateway
 */

import { type NextRequest, NextResponse } from 'next/server'
import { verifyTypedData, type Hex } from 'viem'
import { randomUUID } from 'crypto'

// ─── Config ───────────────────────────────────────────────────────────────
const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as `0x${string}`
const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '5042002')
const SELLER_ADDRESS = (process.env.ADMIN_WALLET_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`
const GATEWAY_WALLET_ADDRESS = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as `0x${string}`

export const NANOPAYMENTS_ENABLED = process.env.NANOPAYMENTS_ENABLED === '1'

// ─── EIP-712 Domain for USDC TransferWithAuthorization ────────────────────
export const USDC_DOMAIN = {
  name: 'GatewayWalletBatched',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: GATEWAY_WALLET_ADDRESS,
} as const

// EIP-3009 TransferWithAuthorization typed data types
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

// ─── Types ─────────────────────────────────────────────────────────────────
export interface X402Challenge {
  /** Payment amount in USDC (human readable, e.g. "0.01") */
  x402Version: number
  scheme: 'exact'
  network: string
  maxAmountRequired: string
  resource: string
  description: string
  mimeType: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  extra: {
    name: string
    version: string
    verifyingContract?: string
  }
}

export interface EIP3009Authorization {
  from: string
  to: string
  value: string       // uint256 in wei
  validAfter: string  // uint256 unix timestamp
  validBefore: string // uint256 unix timestamp
  nonce: string       // bytes32 hex
  signature: string   // hex signature from buyer wallet
}

export interface ParsedPaymentHeader {
  scheme: 'exact'
  network: string
  payload: {
    authorization: EIP3009Authorization
  }
}

/**
 * Parse the X-PAYMENT header from an incoming request.
 * Returns null if missing or malformed.
 */
export function parsePaymentHeader(req: NextRequest): ParsedPaymentHeader | null {
  const header = req.headers.get('X-PAYMENT') ?? req.headers.get('x-payment')
  if (!header) return null
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8')
    return JSON.parse(decoded) as ParsedPaymentHeader
  } catch {
    try {
      return JSON.parse(header) as ParsedPaymentHeader
    } catch {
      return null
    }
  }
}

/**
 * Verify an EIP-3009 TransferWithAuthorization signature.
 * Returns the buyer's address if valid, throws if invalid.
 */
export async function verifyEIP3009Signature(auth: EIP3009Authorization): Promise<string> {
  const message = {
    from: auth.from as `0x${string}`,
    to: auth.to as `0x${string}`,
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce as Hex,
  }

  // Check time validity
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (now < message.validAfter) {
    throw new Error('Payment authorization not yet valid')
  }
  if (now > message.validBefore) {
    throw new Error('Payment authorization expired')
  }

  // Verify recipient is our seller wallet
  if (auth.to.toLowerCase() !== SELLER_ADDRESS.toLowerCase()) {
    throw new Error(`Payment recipient mismatch: expected ${SELLER_ADDRESS}, got ${auth.to}`)
  }

  // Cryptographic signature verification
  const valid = await verifyTypedData({
    address: auth.from as `0x${string}`,
    domain: USDC_DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
    signature: auth.signature as Hex,
  })

  if (!valid) {
    throw new Error('Invalid EIP-3009 signature')
  }

  return auth.from
}

/**
 * Build a standard x402 payment challenge response (HTTP 402).
 * Called when a request arrives without a valid payment header.
 */
export function buildChallengeResponse(opts: {
  resource: string
  amountUsdc: string
  description: string
}): NextResponse {
  const amountWei = String(
    BigInt(Math.round(parseFloat(opts.amountUsdc) * 10 ** USDC_DECIMALS))
  )

  const challenge: X402Challenge = {
    x402Version: 1,
    scheme: 'exact',
    network: `eip155:${CHAIN_ID}`,
    maxAmountRequired: amountWei,
    resource: opts.resource,
    description: opts.description,
    mimeType: 'application/json',
    payTo: SELLER_ADDRESS,
    maxTimeoutSeconds: 300,
    asset: USDC_ADDRESS,
    extra: {
      name: 'GatewayWalletBatched',
      version: '1',
      verifyingContract: GATEWAY_WALLET_ADDRESS,
    },
  }

  return NextResponse.json(
    { error: 'Payment Required', accepts: [challenge] },
    {
      status: 402,
      headers: {
        'X-402-Version': '1',
        'Access-Control-Expose-Headers': 'X-402-Version',
      },
    }
  )
}

/**
 * Middleware: verify x402 payment on a Next.js API route handler.
 *
 * Usage:
 *   export async function POST(req: NextRequest) {
 *     const { buyer, payment, error } = await requireX402Payment(req, { amountUsdc: '0.01', description: '...' })
 *     if (error) return error
 *     // ... proceed with skill execution
 *   }
 */
export async function requireX402Payment(
  req: NextRequest,
  opts: {
    resource: string
    amountUsdc: string
    description: string
  }
): Promise<{ buyer: string | null; payment: ParsedPaymentHeader | null; error: NextResponse | null }> {
  // If nanopayments are disabled, pass through (dev mode)
  if (!NANOPAYMENTS_ENABLED) {
    return { buyer: 'dev-mode', payment: null, error: null }
  }

  const payment = parsePaymentHeader(req)
  if (!payment) {
    return {
      buyer: null,
      payment: null,
      error: buildChallengeResponse(opts),
    }
  }

  try {
    const buyer = await verifyEIP3009Signature(payment.payload.authorization)

    // Queue for batch settlement (fire-and-forget, non-blocking)
    queueAuthorizationForSettlement({
      ...payment.payload.authorization,
      resource: opts.resource,
      amountUsdc: opts.amountUsdc,
    }).catch((err) => console.error('[nanopayments] settlement queue error:', err))

    return { buyer, payment, error: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Payment verification failed'
    return {
      buyer: null,
      payment: null,
      error: NextResponse.json({ error: msg }, { status: 402 }),
    }
  }
}

// ─── In-memory settlement queue (replace with DB in production) ──────────

interface SettlementRecord extends EIP3009Authorization {
  resource: string
  amountUsdc: string
  timestamp: number
  id: string
}

// Exported so the dashboard stats API can read it
export const settlementQueue: SettlementRecord[] = []

export let totalRevenueUsdc = 0.0
export let totalApiCalls = 0
export let totalFailedCalls = 0

export function incrementFailedCalls(): void {
  totalFailedCalls += 1
}

export function resetRevenueCounters(): void {
  totalRevenueUsdc = 0.0
  totalApiCalls = 0
  totalFailedCalls = 0
  settlementQueue.length = 0
}

async function queueAuthorizationForSettlement(
  auth: EIP3009Authorization & { resource: string; amountUsdc: string }
): Promise<void> {
  totalRevenueUsdc += parseFloat(auth.amountUsdc)
  totalApiCalls += 1

  const record: SettlementRecord = {
    ...auth,
    timestamp: Date.now(),
    id: randomUUID(),
  }
  settlementQueue.push(record)

  // Cap queue size to prevent unbounded memory growth
  if (settlementQueue.length > 500) {
    settlementQueue.splice(0, settlementQueue.length - 500)
  }
}

/**
 * Helper to format USDC amount from wei bigint to human-readable string
 */
export function formatUsdc(wei: string | bigint): string {
  const n = typeof wei === 'string' ? BigInt(wei) : wei
  const usdc = Number(n) / 10 ** USDC_DECIMALS
  return usdc.toFixed(4)
}

// ─── Live Request Logs (in-memory, for Dashboard Live Stream) ─────────────

export interface RequestLog {
  id: string
  timestamp: number
  clientIp?: string
  buyer?: string
  endpoint: string
  status: number
  message: string
}

export const requestLogs: RequestLog[] = []

export function logRequest(log: Omit<RequestLog, 'id' | 'timestamp'>): void {
  const record: RequestLog = {
    ...log,
    id: randomUUID(),
    timestamp: Date.now(),
  }
  requestLogs.push(record)
  
  // Keep the log buffer size under control
  if (requestLogs.length > 500) {
    requestLogs.splice(0, requestLogs.length - 500)
  }
}

