import { NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth/session'

export async function GET() {
  try {
    const u = await getCurrentUser()
    return NextResponse.json({
      id: u.id,
      wallet: u.wallet,
      credits: u.credits,
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
