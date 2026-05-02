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
 */
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { users } from '@/lib/db/schema'

const Body = z.object({
  notifyEmail: z
    .union([z.string().email().max(254), z.literal(''), z.null()])
    .optional(),
  emailApiKey: z
    .union([
      // Resend keys look like  re_<32+ chars> ; we accept any provider key
      // that's >= 16 chars and starts with letter/digit (broad).
      z.string().regex(/^[A-Za-z0-9_]{16,200}$/, 'Invalid API key (16+ chars, alphanumeric/underscore)'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  emailFrom: z
    .union([
      z.string().email().max(254),
      // Allow display-name format `Name <email@x.com>`
      z.string().regex(/^.{1,64}\s<[^@\s]+@[^@\s]+\.[^@\s]+>$/, 'Invalid sender (use email or "Name <email@x.com>")'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  telegramChatId: z
    .union([
      z.string().regex(/^(@[a-zA-Z][a-zA-Z0-9_]{4,31}|-?\d{5,20})$/, '@channel or numeric chat id'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  telegramBotToken: z
    .union([
      // Telegram bot tokens look like:  1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
      z.string().regex(/^\d{6,12}:[A-Za-z0-9_-]{30,80}$/, 'Invalid bot token (expected `<digits>:<35 chars>` from @BotFather)'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
})

/** Mask a secret — show last 4 chars only. */
function mask(t: string | null): string | null {
  if (!t) return null
  if (t.length < 8) return '••••'
  return '•'.repeat(Math.min(20, t.length - 4)) + t.slice(-4)
}

interface ProfileResponse {
  notifyEmail: string | null
  emailFrom: string | null
  hasEmailApiKey: boolean
  emailApiKeyMasked: string | null
  telegramChatId: string | null
  hasTelegramBotToken: boolean
  telegramBotTokenMasked: string | null
}

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
    emailApiKeyMasked: mask(u.emailApiKey ?? null),
    telegramChatId: u.telegramChatId ?? null,
    hasTelegramBotToken: !!u.telegramBotToken,
    telegramBotTokenMasked: mask(u.telegramBotToken ?? null),
  }
}

export async function GET() {
  try {
    const u = await getCurrentUser()
    return NextResponse.json({ profile: profileFrom(u) })
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
        patch[k] = v && v !== '' ? v : null
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, unchanged: true })
    }

    await withDbRetry(
      () => db.update(users).set(patch).where(eq(users.id, u.id)),
      { label: 'profile:update' },
    )

    // Build response from `patch` for fields that were sent, falling back
    // to old values for fields that weren't touched.
    const merged = {
      notifyEmail: 'notifyEmail' in patch ? patch.notifyEmail ?? null : u.notifyEmail ?? null,
      emailApiKey: 'emailApiKey' in patch ? patch.emailApiKey ?? null : u.emailApiKey ?? null,
      emailFrom: 'emailFrom' in patch ? patch.emailFrom ?? null : u.emailFrom ?? null,
      telegramChatId:
        'telegramChatId' in patch ? patch.telegramChatId ?? null : u.telegramChatId ?? null,
      telegramBotToken:
        'telegramBotToken' in patch ? patch.telegramBotToken ?? null : u.telegramBotToken ?? null,
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
