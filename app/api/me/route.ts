import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { checkOnChainIdentity, verifyTokenOwnership } from '@/lib/chain/identity'
import { grantSignupBonus } from '@/lib/credits/service'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET() {
  try {
    let u = await getCurrentUser()

    // Two-step identity validation against the user's CURRENT wallet:
    //
    //  1. If DB has a cached identityTokenId, verify the wallet still
    //     owns it on chain. Stale cache is the common bug pattern when
    //     the user switches wallets — the previous wallet's tokenId
    //     remains in the row, the pill renders "TOKEN #X" but the
    //     active wallet doesn't actually own X. We clear in that case.
    //
    //  2. If after step 1 there's no cached token (or never was),
    //     query the chain for any token the wallet owns. If found,
    //     persist it and award the signup bonus (idempotent — won't
    //     re-credit on subsequent /api/me calls thanks to the
    //     signup_grant ledger check inside grantSignupBonus).
    //
    // This is the canonical "always check by user's own wallet" rule.
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
    }

    if (!u.identityTokenId) {
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
    }

    return NextResponse.json({
      id: u.id,
      wallet: u.wallet,
      credits: u.credits,
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
        hasEmailApiKey: !!u.emailApiKey,
        emailApiKeyMasked: u.emailApiKey
          ? '•'.repeat(Math.min(20, u.emailApiKey.length - 4)) + u.emailApiKey.slice(-4)
          : null,
        telegramChatId: u.telegramChatId ?? null,
        hasTelegramBotToken: !!u.telegramBotToken,
        telegramBotTokenMasked: u.telegramBotToken
          ? '•'.repeat(Math.min(20, u.telegramBotToken.length - 4)) + u.telegramBotToken.slice(-4)
          : null,
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
        credits: 0,
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
