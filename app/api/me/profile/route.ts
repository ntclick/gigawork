/**
 * /api/me/profile — read/update user-level notification settings.
 *
 * Profile fields (all user-supplied — NO platform credentials shared):
 *   - notify_email        → recipient email
 *   - email_api_key       → user's Resend API key (sensitive — masked in responses)
 *   - email_from          → user's verified sender (defaults to onboarding@resend.dev)
 *   - telegram_bot_token  → user's bot from @BotFather (sensitive — masked)
 *   - telegram_chat_id    → recipient TG chat for the user's bot
 *
 * Each user runs their own email account + their own Telegram bot. Tokens
 * are stored once and never echoed back in clear text. Skill handlers
 * read them from this profile and redact before recording dispatches into
 * the workflow message log (see lib/ai/tools.ts).
 *
 * email_api_key and telegram_bot_token are ENCRYPTED AT REST — see
 * lib/notifications/secrets.ts. This route is one of only two write
 * boundaries (the other is /api/workflow/[id]/deploy's legacy path), so
 * every value must go through encryptProfileSecret() before it touches
 * the DB, and anything read back for display must be decrypted before
 * masking.
 */
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { users } from '@/lib/db/schema'
import { decryptProfileSecrets, encryptProfileSecret, maskSecret } from '@/lib/notifications/secrets'

const Body = z.object({
  notifyEmail: z
    .union([z.string().trim().email().max(254), z.literal(''), z.null()])
    .optional(),
  emailApiKey: z
    .union([
      z.string().trim().min(1, 'API key cannot be empty'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  emailFrom: z
    .union([
      z.string().trim().min(1, 'Sender cannot be empty'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  telegramChatId: z
    .union([
      z.string().trim().min(1, 'Chat ID cannot be empty'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  telegramBotToken: z
    .union([
      z.string().trim().min(1, 'Bot token cannot be empty'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
})

interface ProfileResponse {
  notifyEmail: string | null
  emailFrom: string | null
  hasEmailApiKey: boolean
  emailApiKeyMasked: string | null
  telegramChatId: string | null
  hasTelegramBotToken: boolean
  telegramBotTokenMasked: string | null
}

/**
 * Builds the client-facing profile shape. `u` must carry PLAINTEXT
 * secrets — run DB rows through decryptProfileSecrets() first, or the
 * "masked" preview would show the tail of the ciphertext envelope.
 */
function profileFrom(u: {
  notifyEmail: string | null
  emailApiKey: string | null
  emailFrom: string | null
  telegramChatId: string | null
  telegramBotToken: string | null
}): ProfileResponse {
  return {
    notifyEmail: u.notifyEmail ?? null,
    emailFrom: u.emailFrom ?? null,
    hasEmailApiKey: !!u.emailApiKey,
    emailApiKeyMasked: maskSecret(u.emailApiKey),
    telegramChatId: u.telegramChatId ?? null,
    hasTelegramBotToken: !!u.telegramBotToken,
    telegramBotTokenMasked: maskSecret(u.telegramBotToken),
  }
}

export async function GET() {
  try {
    const u = await getCurrentUser()
    return NextResponse.json({ profile: profileFrom(decryptProfileSecrets(u)) })
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    console.error('[/api/me/profile GET] failed', e)
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  }
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  try {
    const u = await getCurrentUser()
    const patch: Partial<{
      notifyEmail: string | null
      emailApiKey: string | null
      emailFrom: string | null
      telegramChatId: string | null
      telegramBotToken: string | null
    }> = {}

    const fields: Array<keyof typeof patch> = [
      'notifyEmail',
      'emailApiKey',
      'emailFrom',
      'telegramChatId',
      'telegramBotToken',
    ]
    for (const k of fields) {
      if (k in parsed.data) {
        const v = parsed.data[k]
        // Safeguard: ignore masked placeholders submitted by the client
        if ((k === 'telegramBotToken' || k === 'emailApiKey') && v && v.includes('•')) {
          continue
        }
        patch[k] = v && v !== '' ? v : null
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, unchanged: true })
    }

    // `patch` holds PLAINTEXT (used for the masked response below).
    // Encrypt the two secrets at this write boundary before they touch
    // the DB — see lib/notifications/secrets.ts.
    const dbPatch = { ...patch }
    if ('emailApiKey' in dbPatch) {
      dbPatch.emailApiKey = encryptProfileSecret(dbPatch.emailApiKey)
    }
    if ('telegramBotToken' in dbPatch) {
      dbPatch.telegramBotToken = encryptProfileSecret(dbPatch.telegramBotToken)
    }

    await withDbRetry(
      () => db.update(users).set(dbPatch).where(eq(users.id, u.id)),
      { label: 'profile:update' },
    )

    // Build response from `patch` (plaintext) for fields that were sent,
    // falling back to the stored values for fields that weren't touched —
    // those come from the DB encrypted, so decrypt before masking.
    const stored = decryptProfileSecrets(u)
    const merged = {
      notifyEmail: 'notifyEmail' in patch ? patch.notifyEmail ?? null : u.notifyEmail ?? null,
      emailApiKey: 'emailApiKey' in patch ? patch.emailApiKey ?? null : stored.emailApiKey ?? null,
      emailFrom: 'emailFrom' in patch ? patch.emailFrom ?? null : u.emailFrom ?? null,
      telegramChatId:
        'telegramChatId' in patch ? patch.telegramChatId ?? null : u.telegramChatId ?? null,
      telegramBotToken:
        'telegramBotToken' in patch ? patch.telegramBotToken ?? null : stored.telegramBotToken ?? null,
    }

    return NextResponse.json({ ok: true, profile: profileFrom(merged) })
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    console.error('[/api/me/profile POST] failed', e)
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  }
}
