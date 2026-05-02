import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { creditLedger, users, type User } from '@/lib/db/schema'

export const SIGNUP_GRANT = 300

export class InsufficientCreditsError extends Error {
  constructor(public have: number, public need: number) {
    super(`insufficient credits: have ${have}, need ${need}`)
    this.name = 'InsufficientCreditsError'
  }
}

/**
 * Thrown when a top-up tries to claim a tx_hash that's already in the ledger.
 * The UNIQUE constraint on credit_ledger.tx_hash enforces this at the DB
 * level — this error wraps the Postgres unique-violation so callers can
 * handle the replay case cleanly (return 409 to the client).
 */
export class DuplicateTopupError extends Error {
  constructor(public txHash: string) {
    super(`top-up tx already claimed: ${txHash}`)
    this.name = 'DuplicateTopupError'
  }
}

function normalizeWallet(wallet: string): string {
  return wallet.trim().toLowerCase()
}

/**
 * Returns the user row for a wallet, creating it with the signup grant if
 * absent. Idempotent — repeat calls just return the existing row.
 *
 * Retroactive grant: legacy users created before SIGNUP_GRANT existed (or
 * via the now-removed DEV_WALLET back-door) end up with 0 credits and no
 * signup_grant ledger row. We detect that and grant the bonus once, so
 * everyone hits the same starting line.
 */
export async function getOrCreateUser(wallet: string): Promise<User> {
  const w = normalizeWallet(wallet)
  if (!w) throw new Error('wallet required')

  const [existing] = await withDbRetry(
    () => db.select().from(users).where(eq(users.wallet, w)).limit(1),
    { label: 'getOrCreateUser:select' },
  )
  if (existing) {
    return await maybeRetroactiveGrant(existing)
  }

  const [created] = await withDbRetry(
    () => db
      .insert(users)
      .values({ wallet: w, credits: SIGNUP_GRANT })
      .onConflictDoNothing({ target: users.wallet })
      .returning(),
    { label: 'getOrCreateUser:insert' },
  )

  if (created) {
    await withDbRetry(
      () => db.insert(creditLedger).values({
        userId: created.id,
        delta: SIGNUP_GRANT,
        reason: 'signup_grant',
      }),
      { label: 'getOrCreateUser:ledger-grant' },
    )
    return created
  }

  // Race: another request inserted first. Re-read.
  const [row] = await withDbRetry(
    () => db.select().from(users).where(eq(users.wallet, w)).limit(1),
    { label: 'getOrCreateUser:reread' },
  )
  if (!row) throw new Error('user creation race lost without row')
  return await maybeRetroactiveGrant(row)
}

async function maybeRetroactiveGrant(u: User): Promise<User> {
  // Skip the cheap path: if the user already has any credits or any
  // signup_grant ledger row, they've been initialized properly.
  if (u.credits > 0) return u
  const [grantRow] = await withDbRetry(
    () => db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, u.id), eq(creditLedger.reason, 'signup_grant')))
      .limit(1),
    { label: 'maybeRetroactiveGrant:check' },
  )
  if (grantRow) return u

  const [updated] = await withDbRetry(
    () => db
      .update(users)
      .set({ credits: sql`${users.credits} + ${SIGNUP_GRANT}` })
      .where(eq(users.id, u.id))
      .returning(),
    { label: 'maybeRetroactiveGrant:bump' },
  )
  await withDbRetry(
    () => db.insert(creditLedger).values({
      userId: u.id,
      delta: SIGNUP_GRANT,
      reason: 'signup_grant',
    }),
    { label: 'maybeRetroactiveGrant:ledger' },
  )
  return updated ?? u
}

/**
 * Atomic charge: deducts `amount` from `userId` if balance >= amount, then
 * appends a ledger row. Throws InsufficientCreditsError when balance is
 * too low (no partial charge, no ledger entry).
 *
 * `amount` must be positive. For grants/refunds use grantCredits.
 */
export async function chargeCredits(opts: {
  userId: string
  amount: number
  reason: string
  workflowId?: string | null
}): Promise<{ balance: number }> {
  const { userId, amount, reason, workflowId } = opts
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('amount must be a positive integer')
  }

  const updated = await withDbRetry(
    () => db
      .update(users)
      .set({ credits: sql`${users.credits} - ${amount}` })
      .where(sql`${users.id} = ${userId} and ${users.credits} >= ${amount}`)
      .returning({ credits: users.credits }),
    { label: 'chargeCredits:update' },
  )

  if (updated.length === 0) {
    const [row] = await withDbRetry(
      () => db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).limit(1),
      { label: 'chargeCredits:check-balance' },
    )
    throw new InsufficientCreditsError(row?.credits ?? 0, amount)
  }

  await withDbRetry(
    () => db.insert(creditLedger).values({
      userId,
      delta: -amount,
      reason,
      workflowId: workflowId ?? null,
    }),
    { label: 'chargeCredits:ledger' },
  )

  return { balance: updated[0].credits }
}

/**
 * Add credits (signup bonus, top-up, refund). Always succeeds.
 */
export async function grantCredits(opts: {
  userId: string
  amount: number
  reason: string
  workflowId?: string | null
  txHash?: string | null
}): Promise<{ balance: number }> {
  const { userId, amount, reason, workflowId, txHash } = opts
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('amount must be a positive integer')
  }

  // When txHash is provided, insert ledger row FIRST so the UNIQUE
  // constraint catches replays before we touch the user balance. If the
  // insert succeeds (or no txHash given), we then bump the balance.
  if (txHash) {
    try {
      await db.insert(creditLedger).values({
        userId,
        delta: amount,
        reason,
        workflowId: workflowId ?? null,
        txHash,
      })
    } catch (e: unknown) {
      // Drizzle wraps the underlying postgres-js error in `Failed query: …`.
      // The Postgres SQLSTATE 23505 (unique_violation) is on `cause.code`,
      // and the constraint name lives in `cause.constraint_name`. We also
      // fall back to scanning the message string just in case the driver
      // surface changes.
      const msg = e instanceof Error ? e.message : String(e)
      const cause = (e as { cause?: { code?: string; constraint_name?: string; message?: string } }).cause
      const causeMsg = cause?.message ?? ''
      const isUniqueViolation =
        cause?.code === '23505' ||
        cause?.constraint_name === 'credit_ledger_tx_hash_unique' ||
        /credit_ledger_tx_hash_unique/i.test(msg) ||
        /credit_ledger_tx_hash_unique/i.test(causeMsg) ||
        /duplicate key value/i.test(msg) ||
        /duplicate key value/i.test(causeMsg) ||
        /unique constraint/i.test(msg) ||
        /unique constraint/i.test(causeMsg)
      if (isUniqueViolation) {
        throw new DuplicateTopupError(txHash)
      }
      throw e
    }

    // Balance bump is safe to retry (it's an UPDATE, idempotent on the row)
    const [row] = await withDbRetry(
      () => db
        .update(users)
        .set({ credits: sql`${users.credits} + ${amount}` })
        .where(eq(users.id, userId))
        .returning({ credits: users.credits }),
      { label: 'grantCredits:bump-balance' },
    )

    return { balance: row?.credits ?? 0 }
  }

  // No txHash — legacy path (signup grant, manual admin grant). Same as
  // before: bump balance + insert ledger row.
  const [row] = await withDbRetry(
    () => db
      .update(users)
      .set({ credits: sql`${users.credits} + ${amount}` })
      .where(eq(users.id, userId))
      .returning({ credits: users.credits }),
    { label: 'grantCredits:legacy-bump' },
  )

  await withDbRetry(
    () => db.insert(creditLedger).values({
      userId,
      delta: amount,
      reason,
      workflowId: workflowId ?? null,
      txHash: null,
    }),
    { label: 'grantCredits:legacy-ledger' },
  )

  return { balance: row?.credits ?? 0 }
}

export async function getBalance(userId: string): Promise<number> {
  const [row] = await withDbRetry(
    () => db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).limit(1),
    { label: 'getBalance' },
  )
  return row?.credits ?? 0
}
