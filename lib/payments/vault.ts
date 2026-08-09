/**
 * lib/payments/vault.ts
 *
 * Real per-user custodial vault: every user gets a real EVM wallet
 * (address + private key) that actually holds their USDC on Arc
 * Testnet. The backend holds full signing authority over it — no
 * per-tx user signature is required — so it can act as the ERC-8183
 * escrow "client" signer and the payer for on-chain x402 nanopayments
 * on the user's behalf.
 *
 * This REPLACES the old lib/payments/depositVault.ts::getDedicatedVaultAddress(),
 * which only ever derived a cosmetic display address (keccak256 hash,
 * no private key, no funds ever sent to it — see AGENTS.md / plan doc
 * for the audit that found this). depositVault.ts's ledger helpers
 * (chargeUsdcBalance/depositUsdcBalance) are still correct and stay in
 * use as the fast off-chain metering cache backed by this real vault.
 */
import { eq, sql } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'

import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { withDbRetry } from '@/lib/db/retry'
import { createAgentWallet, prefundAgentWallet, PREFUND_USDC_AMOUNT } from '@/lib/circle/wallet'
import { encryptSecret, decryptSecret } from '@/lib/crypto/walletEncryption'
import { depositUsdcBalance } from '@/lib/payments/depositVault'

const PREFUND_VAULT_GAS = process.env.PREFUND_VAULT_GAS === '1'

export interface ProvisionedVault {
  address: string
}

/**
 * Idempotent, race-safe vault provisioning. Safe to call on every
 * /api/me hit — after the first successful run, `vaultAddress` is set
 * and this becomes a single cheap re-read.
 */
export async function provisionUserVault(userId: string): Promise<ProvisionedVault> {
  const [existing] = await withDbRetry(
    () => db.select({ vaultAddress: users.vaultAddress }).from(users).where(eq(users.id, userId)).limit(1),
    { label: 'provisionUserVault:read' },
  )
  if (existing?.vaultAddress) {
    return { address: existing.vaultAddress }
  }

  const { walletId, walletAddress } = await createAgentWallet()
  const encrypted = encryptSecret(walletId)

  // Guarded write: only claims the row if nobody else provisioned it in
  // the meantime (same race-loser pattern as getOrCreateUser).
  const updated = await withDbRetry(
    () =>
      db
        .update(users)
        .set({
          vaultWalletId: encrypted,
          vaultAddress: walletAddress,
          vaultProvisionedAt: new Date(),
        })
        .where(sql`${users.id} = ${userId} AND ${users.vaultAddress} IS NULL`)
        .returning({ vaultAddress: users.vaultAddress }),
    { label: 'provisionUserVault:write' },
  )

  let address: string
  if (updated.length > 0) {
    address = updated[0].vaultAddress!
    // Best-effort — never let a prefund hiccup block provisioning. The
    // vault still exists and can be topped up with gas later.
    //
    // IMPORTANT: prefundAgentWallet moves REAL USDC on-chain into the
    // vault, so the off-chain spend ledger (users.usdcBalance) must be
    // credited to match — otherwise the user owns USDC the app thinks
    // they don't have and can't spend it. This starter grant replaces
    // the old fake 300-"credits" signup bonus: same onboarding intent,
    // but backed by an actual on-chain transfer. Keyed by the prefund
    // txHash so the topupDeposits UNIQUE constraint makes it idempotent.
    if (PREFUND_VAULT_GAS) {
      prefundAgentWallet(walletAddress)
        .then(async (res) => {
          if (!res.usdcTx) return
          await depositUsdcBalance({
            userId,
            amountUsdc: parseFloat(PREFUND_USDC_AMOUNT),
            reason: 'vault_prefund',
            txHash: res.usdcTx,
          })
        })
        .catch((e) =>
          console.warn(`[provisionUserVault] prefund failed for ${walletAddress}:`, e instanceof Error ? e.message : e),
        )
    }
  } else {
    // Lost the race — someone else provisioned first. Re-read the winner's row.
    const [row] = await withDbRetry(
      () => db.select({ vaultAddress: users.vaultAddress }).from(users).where(eq(users.id, userId)).limit(1),
      { label: 'provisionUserVault:reread' },
    )
    if (!row?.vaultAddress) throw new Error(`vault provisioning race lost without a row for user ${userId}`)
    address = row.vaultAddress
  }

  return { address }
}

/**
 * Returns a viem Account for the user's vault, decrypting the stored
 * private key. Throws if the vault hasn't been provisioned yet — call
 * provisionUserVault() first (already happens transparently via
 * /api/me on every page load).
 */
export async function getUserVaultAccount(userId: string) {
  const [row] = await withDbRetry(
    () => db.select({ vaultWalletId: users.vaultWalletId }).from(users).where(eq(users.id, userId)).limit(1),
    { label: 'getUserVaultAccount:read' },
  )
  if (!row?.vaultWalletId) {
    throw new Error(`user ${userId} has no provisioned vault — call provisionUserVault() first`)
  }
  return privateKeyToAccount(await getUserVaultPrivateKey(userId, row.vaultWalletId))
}

/**
 * Minimum native balance a vault must hold before a run is allowed to
 * start, in whole USDC (Arc's native gas token, 18 decimals).
 *
 * Grounded in measurement rather than guessed: at the observed gas price
 * a contract call on Arc Testnet costs ~0.0034 and a plain transfer
 * ~0.00047. A run spends roughly eight of them — four to open and fund
 * the ERC-8183 escrow, one x402 transfer per agent, one to settle — so
 * ~0.03 covers it. The default leaves headroom for a gas spike without
 * being so high it blocks a legitimately funded vault.
 */
const MIN_GAS_NATIVE = parseFloat(process.env.VAULT_MIN_GAS_USDC ?? '0.05')

export interface VaultFunding {
  ok: boolean
  /** Native gas balance, whole units (18 decimals on Arc). */
  nativeBalance: number
  /** ERC-20 USDC balance, whole units (6 decimals). */
  usdcBalance: number
  requiredUsdc: number
  requiredNative: number
  /** Machine-readable reason when `ok` is false. */
  reason: 'insufficient_usdc' | 'insufficient_gas' | null
}

/**
 * Read what the vault ACTUALLY holds on-chain, and say whether a run can
 * be paid for.
 *
 * The pre-existing gate read `users.usdc_balance` — a database cache of
 * the ledger. That number can be perfectly healthy while the vault itself
 * cannot pay: the ledger tracks USDC owed to the user, not the native gas
 * the vault burns to move it. A run that passed that gate would create a
 * workflow, fail to open its escrow, fail every x402 transfer, and still
 * run all its agents and publish a report — the user got billed nothing
 * and told nothing, and the agents worked for free.
 *
 * Both balances are read from the chain so the answer reflects the wallet
 * that will actually sign, not what a cache believes.
 */
export async function checkVaultFunding(
  userId: string,
  requiredUsdc: number,
): Promise<VaultFunding> {
  const { createPublicClient, http, formatUnits, erc20Abi } = await import('viem')
  const { arcTestnet } = await import('@/lib/chain/arcTestnet')

  const account = await getUserVaultAccount(userId)
  const client = createPublicClient({ chain: arcTestnet, transport: http() })
  const usdcAddress = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
    '0x3600000000000000000000000000000000000000') as `0x${string}`

  const [nativeWei, usdc6] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }) as Promise<bigint>,
  ])

  const nativeBalance = parseFloat(formatUnits(nativeWei, 18))
  const usdcBalance = parseFloat(formatUnits(usdc6, 6))

  const reason: VaultFunding['reason'] =
    usdcBalance < requiredUsdc
      ? 'insufficient_usdc'
      : nativeBalance < MIN_GAS_NATIVE
        ? 'insufficient_gas'
        : null

  return {
    ok: reason === null,
    nativeBalance,
    usdcBalance,
    requiredUsdc,
    requiredNative: MIN_GAS_NATIVE,
    reason,
  }
}

/**
 * The vault's raw private key.
 *
 * Deliberately a separate, awkwardly-named export rather than a field on
 * the account above: almost everything should sign through the viem
 * Account and never see this. It exists only for third-party SDKs that
 * insist on a raw key — currently Circle's viem adapter in /api/appkit.
 * Every call site is a place to check before adding another.
 */
export async function getUserVaultPrivateKey(
  userId: string,
  known?: string,
): Promise<`0x${string}`> {
  let stored = known
  if (!stored) {
    const [row] = await withDbRetry(
      () =>
        db
          .select({ vaultWalletId: users.vaultWalletId })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
      { label: 'getUserVaultPrivateKey:read' },
    )
    if (!row?.vaultWalletId) {
      throw new Error(`user ${userId} has no provisioned vault — call provisionUserVault() first`)
    }
    stored = row.vaultWalletId
  }
  const privateKey = decryptSecret(stored)
  return (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`
}
