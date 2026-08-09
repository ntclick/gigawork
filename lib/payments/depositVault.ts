import { db } from '@/lib/db/client'
import { users, topupDeposits } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { withDbRetry } from '@/lib/db/retry'

// NOTE: getDedicatedVaultAddress() used to live here — it derived a
// cosmetic keccak256 display address with no private key, no deployed
// contract, and no funds ever sent to it (see the vault-architecture
// plan doc / AGENTS.md security audit). It has been replaced by a REAL
// per-user custodial wallet: see lib/payments/vault.ts
// (provisionUserVault / getUserVaultAccount), backed by
// users.vaultAddress / users.vaultWalletId.

export class InsufficientUsdcError extends Error {
  constructor(public have: number, public need: number) {
    super(`Insufficient USDC vault balance: have $${have.toFixed(2)}, need $${need.toFixed(2)}`)
    this.name = 'InsufficientUsdcError'
  }
}

export class DuplicateTopupError extends Error {
  constructor(public txHash: string) {
    super(`Transaction hash ${txHash} has already been credited.`)
    this.name = 'DuplicateTopupError'
  }
}

/**
 * Charge USDC directly from user's vault balance atomically.
 */
export async function chargeUsdcBalance(opts: {
  userId: string
  amountUsdc: number
  reason: string
  workflowId?: string | null
}): Promise<{ balance: number }> {
  const { userId, amountUsdc } = opts
  if (amountUsdc <= 0) return { balance: 0 }

  const amountStr = amountUsdc.toFixed(2)

  const updated = await withDbRetry(
    () => db
      .update(users)
      .set({
        usdcBalance: sql`GREATEST(0, coalesce(${users.usdcBalance}::numeric, 0) - ${amountStr}::numeric)`,
      })
      .where(sql`${users.id} = ${userId} AND coalesce(${users.usdcBalance}::numeric, 0) >= ${amountStr}::numeric`)
      .returning({ usdcBalance: users.usdcBalance }),
    { label: 'chargeUsdcBalance:update' },
  )

  if (updated.length === 0) {
    const [row] = await withDbRetry(
      () => db.select({ usdcBalance: users.usdcBalance }).from(users).where(eq(users.id, userId)).limit(1),
      { label: 'chargeUsdcBalance:check-balance' },
    )
    const currentHave = parseFloat(row?.usdcBalance || '0')
    throw new InsufficientUsdcError(currentHave, amountUsdc)
  }

  return { balance: parseFloat(updated[0].usdcBalance || '0') }
}

/**
 * Grant or Deposit USDC directly into user's vault balance.
 */
export async function depositUsdcBalance(opts: {
  userId: string
  amountUsdc: number
  reason: string
  txHash?: string | null
}): Promise<{ balance: number }> {
  const { userId, amountUsdc, reason, txHash } = opts
  if (amountUsdc <= 0) return { balance: 0 }

  const amountStr = amountUsdc.toFixed(2)

  if (txHash) {
    try {
      await db.insert(topupDeposits).values({
        userId,
        txHash,
        amountUsdc: amountStr,
        reason,
      })
    } catch (e: unknown) {
      // Drizzle wraps the underlying postgres-js error in `Failed query: …`
      // — the real Postgres SQLSTATE (23505 = unique_violation) and
      // message live on `e.cause`, not on `e` directly. Checking only
      // the outer error (as this used to) silently missed every replay
      // — see lib/credits/service.ts::grantCredits for the same fix
      // applied to the parallel credits system.
      const msg = e instanceof Error ? e.message : String(e)
      const cause = (e as { cause?: { code?: string; constraint_name?: string; message?: string } }).cause
      const causeMsg = cause?.message ?? ''
      const isUniqueViolation =
        cause?.code === '23505' ||
        cause?.constraint_name === 'topup_deposits_tx_hash_key' ||
        /topup_deposits_tx_hash/i.test(msg) ||
        /topup_deposits_tx_hash/i.test(causeMsg) ||
        /duplicate key value/i.test(msg) ||
        /duplicate key value/i.test(causeMsg) ||
        /unique constraint/i.test(msg) ||
        /unique constraint/i.test(causeMsg)
      if (isUniqueViolation) {
        throw new DuplicateTopupError(txHash)
      }
      console.warn('[depositUsdcBalance] topupDeposits ledger warning', e)
    }
  }

  const [updated] = await withDbRetry(
    () => db
      .update(users)
      .set({
        usdcBalance: sql`coalesce(${users.usdcBalance}::numeric, 0) + ${amountStr}::numeric`,
      })
      .where(eq(users.id, userId))
      .returning({ usdcBalance: users.usdcBalance }),
    { label: 'depositUsdcBalance:update' },
  )

  return { balance: parseFloat(updated?.usdcBalance || '0') }
}
