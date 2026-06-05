/**
 * Post-mint side effects.
 *
 * When a user successfully mints their ERC-8004 identity NFT, the platform:
 *   1. Pre-funds the user's wallet with native gas + ERC-20 USDC so they can
 *      pay into ERC-8183 escrow without a separate faucet trip.
 *   2. Idempotently ensures the signup_grant credits ledger row exists (via
 *      maybeRetroactiveGrant — already runs in getOrCreateUser, but this
 *      gives us a single chokepoint to extend later if we want to GATE the
 *      300-credit grant on mint specifically rather than on signup).
 *
 * Failure here MUST NOT roll back the mint. The NFT is already on-chain at
 * this point — losing the pre-fund just means the user has to top up
 * manually before their first workflow. Log + swallow.
 *
 * Gated by env: PREFUND_AFTER_MINT=1. Default off so we don't accidentally
 * burn admin USDC on every test mint.
 */
import { eq } from 'drizzle-orm'
import { encodeFunctionData, getAddress, parseAbi, parseEther, parseUnits, type Hex } from 'viem'

import { adminAccount, publicClient, sendAdminTransaction } from '@/lib/chain/client'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as `0x${string}`
const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')

const PREFUND_ENABLED = process.env.PREFUND_AFTER_MINT === '1'
const PREFUND_NATIVE_AMOUNT = process.env.PREFUND_NATIVE_AMOUNT ?? '0.01'  // 18-decimal native gas
const PREFUND_USDC_AMOUNT = process.env.PREFUND_USDC_AMOUNT ?? '0.3'      // 6-decimal escrow USDC

const erc20Abi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address a) view returns (uint256)',
])

export interface PrefundResult {
  enabled: boolean
  skipped?: 'already_funded' | 'admin_unconfigured'
  nativeTx?: Hex
  usdcTx?: Hex
  nativeAmount?: string
  usdcAmount?: string
  error?: string
}

/**
 * One-shot pre-fund: skips entirely if the user wallet already holds enough
 * USDC (likely a re-mint or manual faucet). Only fires gas + USDC top-up for
 * net-new wallets. Idempotent on user_id via the prefunded_at column.
 */
export async function prefundUserWallet(opts: {
  userId: string
  wallet: string
}): Promise<PrefundResult> {
  if (!PREFUND_ENABLED) return { enabled: false }
  if (!adminAccount) {
    return { enabled: true, skipped: 'admin_unconfigured' }
  }

  // Check if we already pre-funded this user (column added in migration below).
  const [row] = await db
    .select({ prefundedAt: users.prefundedAt })
    .from(users)
    .where(eq(users.id, opts.userId))
    .limit(1)
  if (row?.prefundedAt) {
    return { enabled: true, skipped: 'already_funded' }
  }

  const target = getAddress(opts.wallet)
  const usdcAmount = parseUnits(PREFUND_USDC_AMOUNT, USDC_DECIMALS)
  const nativeAmount = parseEther(PREFUND_NATIVE_AMOUNT)

  // Skip native if the user already has gas (e.g. re-mint after manual faucet)
  let nativeTx: Hex | undefined
  try {
    const nativeBal = await publicClient.getBalance({ address: target })
    if (nativeBal < nativeAmount / BigInt(2)) {
      nativeTx = await sendAdminTransaction({ to: target, value: nativeAmount })
      await publicClient.waitForTransactionReceipt({ hash: nativeTx, confirmations: 1, timeout: 30_000 })
    }
  } catch (e) {
    console.warn('[prefund] native tx failed', e instanceof Error ? e.message : e)
    return { enabled: true, error: `native: ${e instanceof Error ? e.message : String(e)}` }
  }

  // Skip USDC if the user already holds enough (re-mint scenario).
  let usdcTx: Hex | undefined
  try {
    const usdcBal = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [target],
    })
    if (usdcBal < usdcAmount / BigInt(2)) {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [target, usdcAmount],
      })
      usdcTx = await sendAdminTransaction({ to: USDC_ADDRESS, data })
      await publicClient.waitForTransactionReceipt({ hash: usdcTx, confirmations: 1, timeout: 30_000 })
    }
  } catch (e) {
    console.warn('[prefund] usdc tx failed', e instanceof Error ? e.message : e)
    return { enabled: true, nativeTx, error: `usdc: ${e instanceof Error ? e.message : String(e)}` }
  }

  // Mark prefunded so retries don't double-spend admin balance.
  await db
    .update(users)
    .set({ prefundedAt: new Date() })
    .where(eq(users.id, opts.userId))

  return {
    enabled: true,
    nativeTx,
    usdcTx,
    nativeAmount: PREFUND_NATIVE_AMOUNT,
    usdcAmount: PREFUND_USDC_AMOUNT,
  }
}
