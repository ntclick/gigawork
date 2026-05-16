import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { creditLedger, users, workflows, type User } from '@/lib/db/schema'

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
 * Returns the user row for a wallet, creating it with ZERO credits if
 * absent. Idempotent — repeat calls just return the existing row.
 *
 * IMPORTANT: signup credits are NOT granted here anymore. Auth must be
 * a pure identity resolution: each /api/auth/login call (and every
 * downstream getCurrentUser) used to fire signup_grant for fresh rows,
 * and any wallet flip + merge caused the 300 cr to be moved from a
 * just-created row into the surviving Privy user, multiplying credits
 * on every back-and-forth. Signup credits are now granted exactly once
 * in `grantSignupBonus()` — currently called from /api/identity/confirm
 * and /api/me on the on-chain NFT auto-sync path. See AGENTS.md (or the
 * commit that introduced grantSignupBonus) for the full rationale.
 */
export async function getOrCreateUser(wallet: string): Promise<User> {
  const w = normalizeWallet(wallet)
  if (!w) throw new Error('wallet required')

  const [existing] = await withDbRetry(
    () => db.select().from(users).where(eq(users.wallet, w)).limit(1),
    { label: 'getOrCreateUser:select' },
  )
  if (existing) return existing

  const [created] = await withDbRetry(
    () => db
      .insert(users)
      .values({ wallet: w, credits: 0 })
      .onConflictDoNothing({ target: users.wallet })
      .returning(),
    { label: 'getOrCreateUser:insert' },
  )
  if (created) return created

  // Race: another request inserted first. Re-read.
  const [row] = await withDbRetry(
    () => db.select().from(users).where(eq(users.wallet, w)).limit(1),
    { label: 'getOrCreateUser:reread' },
  )
  if (!row) throw new Error('user creation race lost without row')
  return row
}

/**
 * Idempotent one-time signup bonus. Called when (a) the user successfully
 * mints their ERC-8004 identity NFT, or (b) /api/me auto-syncs and
 * discovers an on-chain NFT minted from a different frontend.
 *
 * "Already granted" detection: a `signup_grant` ledger row for this
 * user. We check by user.id AND by privy_id (joined via users) so that
 * wallet merges don't trigger a second grant — if the user previously
 * had a row that received signup_grant, the merge moved that ledger
 * row to the surviving user, and we'll see it here.
 *
 * Returns the updated user row, or the original if no grant was needed.
 */
export async function grantSignupBonus(userId: string): Promise<User> {
  const [u] = await withDbRetry(
    () => db.select().from(users).where(eq(users.id, userId)).limit(1),
    { label: 'grantSignupBonus:read' },
  )
  if (!u) throw new Error(`user ${userId} not found`)

  const [existing] = await withDbRetry(
    () => db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, userId), eq(creditLedger.reason, 'signup_grant')))
      .limit(1),
    { label: 'grantSignupBonus:check' },
  )
  if (existing) return u

  const [updated] = await withDbRetry(
    () =>
      db
        .update(users)
        .set({ credits: sql`${users.credits} + ${SIGNUP_GRANT}` })
        .where(eq(users.id, userId))
        .returning(),
    { label: 'grantSignupBonus:update' },
  )
  await withDbRetry(
    () =>
      db.insert(creditLedger).values({
        userId,
        delta: SIGNUP_GRANT,
        reason: 'signup_grant',
      }),
    { label: 'grantSignupBonus:ledger' },
  )
  return updated ?? u
}

/**
 * Privy-DID-keyed upsert. This is the new auth entry point — Privy DID
 * (eg `did:privy:abc…`) is stable across wallet switches inside the
 * same Privy account, so workflows survive the user changing OKX
 * accounts mid-session.
 *
 * Behavior:
 *  1. Lookup by privy_id → if found, update `wallet` to current active
 *     address (so signer checks like `tx.from === user.wallet` always
 *     hit the wallet the user is currently signing with).
 *  2. Else lookup by wallet → if found (legacy row from before Privy DID
 *     was tracked), attach privy_id to migrate the row in-place.
 *  3. Else create a fresh user row with both privy_id and wallet set.
 *
 * When wallet changes between calls (i.e. user switched OKX account),
 * clear stale identity_token_id so /api/me re-reads the new wallet's
 * ERC-8004 NFT from on-chain via checkOnChainIdentity.
 */
export async function getOrCreateUserByPrivy(
  privyId: string,
  wallet: string,
): Promise<User> {
  const w = normalizeWallet(wallet)
  if (!privyId) throw new Error('privyId required')
  if (!w) throw new Error('wallet required')

  // Path 1: user already linked to this Privy DID.
  const [byPrivy] = await withDbRetry(
    () => db.select().from(users).where(eq(users.privyId, privyId)).limit(1),
    { label: 'getOrCreateUserByPrivy:byPrivy' },
  )
  if (byPrivy) {
    if (byPrivy.wallet === w) return byPrivy
    // Wallet switched. The new address may already exist as a separate
    // user row (created before privy_id existed, eg from a stale dev
    // session) — its workflows/credits would be unreachable from this
    // Privy account. Merge that row into the current user before
    // bumping wallet, so nothing is orphaned.
    //
    // The conflicting row may also hold the identity_token_id for the
    // wallet we're about to acquire — capture it before deletion so we
    // can carry the cached NFT over to the surviving user row.
    const [conflict] = await withDbRetry(
      () => db.select().from(users).where(eq(users.wallet, w)).limit(1),
      { label: 'getOrCreateUserByPrivy:walletConflict' },
    )
    let inheritedIdentity:
      | { tokenId: string | null; txHash: string | null; mintedAt: Date | null }
      | null = null
    if (conflict && conflict.id !== byPrivy.id) {
      if (conflict.privyId && conflict.privyId !== privyId) {
        // Cross-account collision — same external wallet linked to two
        // distinct Privy DIDs. Refuse to merge (would mix two users'
        // data). Tell the caller so the UI can surface a clear error.
        throw new Error(
          `wallet ${w} is already linked to a different Privy account`,
        )
      }
      // Snapshot NFT info from the row we're about to delete.
      inheritedIdentity = {
        tokenId: conflict.identityTokenId,
        txHash: conflict.identityTxHash,
        mintedAt: conflict.identityMintedAt,
      }
      await mergeUserInto({ srcUserId: conflict.id, dstUserId: byPrivy.id })
    }
    // Bump wallet. For identity_token_id, the rule is "NFT MUST belong
    // to the wallet now in the row":
    //   1. If the merged conflict row holds the NFT for wallet=w, keep
    //      it — that row was created when this wallet minted, so the
    //      tokenId is provably owned by w.
    //   2. Otherwise CLEAR. byPrivy.identityTokenId was minted by the
    //      OLD wallet (byPrivy.wallet, which we're about to overwrite),
    //      so it doesn't belong to w. Carrying it over would render a
    //      "TOKEN #X" pill that the active wallet doesn't actually own.
    //      Downstream /api/me + /api/workflow run verifyTokenOwnership
    //      / checkOnChainIdentity to repopulate with the right tokenId
    //      if w owns one on chain.
    const nextIdentity = inheritedIdentity ?? {
      tokenId: null,
      txHash: null,
      mintedAt: null,
    }
    const [updated] = await withDbRetry(
      () => db
        .update(users)
        .set({
          wallet: w,
          identityTokenId: nextIdentity.tokenId,
          identityTxHash: nextIdentity.txHash,
          identityMintedAt: nextIdentity.mintedAt,
        })
        .where(eq(users.id, byPrivy.id))
        .returning(),
      { label: 'getOrCreateUserByPrivy:bumpWallet' },
    )
    return updated ?? byPrivy
  }

  // Path 2: legacy row created before privyId existed — wallet is unique,
  // so we attach privyId now and use the same row going forward.
  const [byWallet] = await withDbRetry(
    () => db.select().from(users).where(eq(users.wallet, w)).limit(1),
    { label: 'getOrCreateUserByPrivy:byWallet' },
  )
  if (byWallet) {
    const [updated] = await withDbRetry(
      () => db
        .update(users)
        .set({ privyId })
        .where(eq(users.id, byWallet.id))
        .returning(),
      { label: 'getOrCreateUserByPrivy:attachPrivyId' },
    )
    return updated ?? byWallet
  }

  // Path 3: fresh user. Credits start at 0 — the signup bonus only fires
  // when the user actually mints their NFT (see grantSignupBonus()).
  const [created] = await withDbRetry(
    () => db
      .insert(users)
      .values({ wallet: w, privyId, credits: 0 })
      .onConflictDoNothing({ target: users.wallet })
      .returning(),
    { label: 'getOrCreateUserByPrivy:insert' },
  )
  if (created) {
    return created
  }

  // Race-loser path.
  const [row] = await withDbRetry(
    () => db.select().from(users).where(eq(users.wallet, w)).limit(1),
    { label: 'getOrCreateUserByPrivy:reread' },
  )
  if (!row) throw new Error('user creation race lost without row')
  // Attach privyId if the winner created without it (shouldn't happen but defensive).
  if (!row.privyId) {
    const [updated] = await withDbRetry(
      () => db.update(users).set({ privyId }).where(eq(users.id, row.id)).returning(),
      { label: 'getOrCreateUserByPrivy:race-attach' },
    )
    return updated ?? row
  }
  return row
}

/**
 * Move all resources from `srcUserId` to `dstUserId`, sum credits, then
 * delete the source row. Used when two user rows turn out to belong to
 * the same human (eg legacy row with NULL privy_id whose wallet now
 * gets re-acquired by the user's Privy account).
 *
 * Runs as a single transaction so we don't leave dangling FKs if any
 * step fails. The source row's wallet is freed (UNIQUE constraint
 * released) before the caller updates the destination's wallet.
 */
async function mergeUserInto(opts: {
  srcUserId: string
  dstUserId: string
}): Promise<void> {
  await withDbRetry(
    () =>
      db.transaction(async (tx) => {
        // Re-point workflows. Done first so the row delete at the end
        // doesn't take dependent rows with it via ON DELETE.
        await tx
          .update(workflows)
          .set({ userId: opts.dstUserId })
          .where(eq(workflows.userId, opts.srcUserId))

        // Dedupe signup_grant: each user should accumulate at most ONE
        // signup_grant in their lifetime. If both src and dst have one,
        // delete src's BEFORE moving the rest. We subtract its delta
        // from src.credits so the post-merge sum below doesn't carry
        // the duplicate 300 cr into the destination — that's the bug
        // that made credits compound on every wallet flip+merge.
        const [dstSignup] = await tx
          .select({ id: creditLedger.id })
          .from(creditLedger)
          .where(
            and(
              eq(creditLedger.userId, opts.dstUserId),
              eq(creditLedger.reason, 'signup_grant'),
            ),
          )
          .limit(1)
        let srcSignupDelta = 0
        if (dstSignup) {
          const [srcSignup] = await tx
            .select({ id: creditLedger.id, delta: creditLedger.delta })
            .from(creditLedger)
            .where(
              and(
                eq(creditLedger.userId, opts.srcUserId),
                eq(creditLedger.reason, 'signup_grant'),
              ),
            )
            .limit(1)
          if (srcSignup) {
            srcSignupDelta = srcSignup.delta
            await tx
              .delete(creditLedger)
              .where(eq(creditLedger.id, srcSignup.id))
          }
        }

        // Re-point remaining ledger entries from src to dst.
        await tx
          .update(creditLedger)
          .set({ userId: opts.dstUserId })
          .where(eq(creditLedger.userId, opts.srcUserId))

        // Sum credits onto destination, minus any duplicate signup grant
        // we just removed.
        const [src] = await tx
          .select({ credits: users.credits })
          .from(users)
          .where(eq(users.id, opts.srcUserId))
          .limit(1)
        const carryover = (src?.credits ?? 0) - srcSignupDelta
        if (carryover > 0) {
          await tx
            .update(users)
            .set({ credits: sql`${users.credits} + ${carryover}` })
            .where(eq(users.id, opts.dstUserId))
        }

        // Free the wallet uniqueness slot, then drop the row.
        await tx.delete(users).where(eq(users.id, opts.srcUserId))
      }),
    { label: 'mergeUserInto' },
  )
}

// maybeRetroactiveGrant was removed — its responsibilities are now split:
//  - Pure user resolution lives in getOrCreateUser{,ByPrivy} (zero credits).
//  - Bonus grant lives in grantSignupBonus(userId), idempotent + called
//    only from mint paths (/api/identity/confirm, /api/me on-chain sync,
//    /api/identity/mint admin path).

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
