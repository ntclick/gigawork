import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { parseAbi } from 'viem'
import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { checkOnChainIdentity, verifyTokenOwnership } from '@/lib/chain/identity'
import { publicClient } from '@/lib/chain/client'
import { grantSignupBonus } from '@/lib/credits/service'
import { db } from '@/lib/db/client'
import { decryptProfileSecrets, maskSecret } from '@/lib/notifications/secrets'
import { provisionUserVault } from '@/lib/payments/vault'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const identityCache = new Map<string, { ts: number; owns: boolean; tokenId: string | null }>()
const IDENTITY_CACHE_TTL = 30_000

// Lazy on-chain balance reconciliation — see lib/payments/vault.ts doc
// comment. We only trust on-chain reads to correct the fast off-chain
// ledger DOWN (funds spent out-of-band); never auto-credit up, since
// that would reopen the topup replay-protection hole that
// /api/me/topup's unique-txHash check exists to close.
const reconcileCache = new Map<string, number>()
const RECONCILE_TTL = 60_000
const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`
const usdcAbi = parseAbi(['function balanceOf(address a) view returns (uint256)'])
const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')

async function reconcileVaultBalance(userId: string, vaultAddress: string, ledgerBalance: number): Promise<number> {
  const now = Date.now()
  const last = reconcileCache.get(userId)
  if (last && now - last < RECONCILE_TTL) return ledgerBalance

  reconcileCache.set(userId, now)
  try {
    const raw = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [vaultAddress as `0x${string}`],
    })
    const onChain = Number(raw) / 10 ** USDC_DECIMALS
    if (onChain < ledgerBalance - 0.000001) {
      // Something spent real funds out-of-band (e.g. an escrow/x402 send
      // whose ledger debit didn't land) — trust the chain, correct down.
      await db.update(users).set({ usdcBalance: onChain.toFixed(2) }).where(eq(users.id, userId))
      return onChain
    }
  } catch (e) {
    console.warn('[/api/me] vault balance reconcile failed', e instanceof Error ? e.message : e)
  }
  return ledgerBalance
}

export async function GET() {
  try {
    let u = await getCurrentUser()

    const now = Date.now()
    const cachedIdentity = identityCache.get(u.wallet?.toLowerCase() ?? '')

    if (cachedIdentity && now - cachedIdentity.ts < IDENTITY_CACHE_TTL) {
      if (!cachedIdentity.owns && u.identityTokenId) {
        u.identityTokenId = null
      }
    } else if (u.wallet) {
      const walletKey = u.wallet.toLowerCase()
      if (u.identityTokenId) {
        const stillOwns = await verifyTokenOwnership(u.identityTokenId, u.wallet)
        if (!stillOwns) {
          const [cleared] = await db
            .update(users)
            .set({ identityTokenId: null, identityTxHash: null, identityMintedAt: null })
            .where(eq(users.id, u.id))
            .returning()
          if (cleared) u = cleared
        }
        identityCache.set(walletKey, { ts: now, owns: stillOwns, tokenId: u.identityTokenId })
      } else {
        const onChainTokenId = await checkOnChainIdentity(u.wallet)
        if (onChainTokenId) {
          const [updated] = await db
            .update(users)
            .set({ identityTokenId: onChainTokenId })
            .where(eq(users.id, u.id))
            .returning()
          if (updated) {
            u = updated
            try {
              u = await grantSignupBonus(u.id)
            } catch (e) {
              console.warn('[/api/me] signup grant failed', e instanceof Error ? e.message : e)
            }
          }
        }
        identityCache.set(walletKey, { ts: now, owns: !!onChainTokenId, tokenId: onChainTokenId })
      }
    }

    // Lazy, idempotent, race-safe provisioning — first hit after signup
    // generates the real vault; every hit after that is a cheap re-read.
    const { address: vaultAddr } = await provisionUserVault(u.id)

    let usdcBalance = parseFloat(u.usdcBalance || '0')
    usdcBalance = await reconcileVaultBalance(u.id, vaultAddr, usdcBalance)

    const profileSecrets = decryptProfileSecrets(u)

    return NextResponse.json({
      id: u.id,
      wallet: u.wallet,
      // `credits` is intentionally not returned any more — the synthetic
      // credits currency was retired in favour of the real USDC vault
      // balance below. See lib/credits/service.ts.
      usdcBalance,
      // The ERC-8183 escrow deposit taken when a workflow is created. The
      // client needs it to quote the true cost before the user commits —
      // agent fees alone understate what leaves the vault. Served from the
      // server value rather than a NEXT_PUBLIC_ twin so the quote can never
      // drift from what is actually charged.
      escrowBudgetUsdc: process.env.ERC8183_BUDGET_USDC ?? '0.05',
      dedicatedVaultAddress: vaultAddr,
      reputationScore: u.reputationScore,
      createdAt: u.createdAt,
      identity: {
        hasIdentity: !!u.identityTokenId,
        tokenId: u.identityTokenId,
        txHash: u.identityTxHash,
        mintedAt: u.identityMintedAt,
      },
      profile: {
        notifyEmail: u.notifyEmail ?? null,
        emailFrom: u.emailFrom ?? null,
        // Secrets never returned in cleartext — only a presence flag +
        // masked preview so the UI can render "•••••xxx · saved".
        // They're encrypted at rest, so decrypt first: masking the
        // ciphertext would show the tail of the base64 envelope instead
        // of the last 4 chars the user actually recognises.
        hasEmailApiKey: !!u.emailApiKey,
        emailApiKeyMasked: maskSecret(profileSecrets.emailApiKey),
        telegramChatId: u.telegramChatId ?? null,
        hasTelegramBotToken: !!u.telegramBotToken,
        telegramBotTokenMasked: maskSecret(profileSecrets.telegramBotToken),
      },
    })
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    // Even with retry, sustained Supabase outage / DNS block can fail.
    // Return 503 with a stable shape so the UI doesn't blow up — pages
    // gracefully fall back to "loading…" until the next poll succeeds.
    console.error('[/api/me] failed after retries', e)
    return NextResponse.json(
      {
        id: null,
        wallet: null,
        usdcBalance: 0,
        dedicatedVaultAddress: null,
        identity: { hasIdentity: false, tokenId: null, txHash: null, mintedAt: null },
        profile: {
          notifyEmail: null,
          emailFrom: null,
          hasEmailApiKey: false,
          emailApiKeyMasked: null,
          telegramChatId: null,
          hasTelegramBotToken: false,
          telegramBotTokenMasked: null,
        },
        error: 'db_unavailable',
      },
      { status: 503 },
    )
  }
}
