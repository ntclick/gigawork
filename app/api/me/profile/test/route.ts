/**
 * POST /api/me/profile/test  { kind: 'email' | 'telegram' }
 *
 * Sends a real test message using the user's saved profile credentials,
 * so the user can verify config before running a workflow that depends
 * on it. Routes through the skill endpoints (`/api/skills/email-sender`
 * and `/api/skills/telegram-sender`) so the test path is identical to
 * production — same redaction, same provider, same error shape.
 *
 *   - kind=email     → uses notify_email + email_api_key + email_from
 *   - kind=telegram  → uses telegram_chat_id + telegram_bot_token
 *
 * Response is the same shape the skill handler returns, plus a `kind`
 * tag so the UI can route the result back to the right input section.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { decryptProfileSecrets } from '@/lib/notifications/secrets'


const Body = z.object({
  kind: z.enum(['email', 'telegram']),
})

const TEST_BODY_MD = `## ✅ GigaWork test message

Your **email-sender** agent is configured correctly.

This was sent to verify your saved credentials. Future workflow results
will arrive at this address.

— GigaWork`

const TEST_TG = `✅ *GigaWork test message*\n\nYour \`telegram-sender\` bot is configured. Workflow results will arrive in this chat.`

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  let u
  try {
    // Secrets are encrypted at rest — decrypt before sending the real
    // test message (see lib/notifications/secrets.ts).
    u = decryptProfileSecrets(await getCurrentUser())
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    console.error('[/api/me/profile/test] auth failed', e)
    return NextResponse.json({ error: 'auth_failed' }, { status: 503 })
  }

  // Build skill input from saved profile + check prerequisites here
  // (clearer error UX than a 500 from the skill handler).
  if (parsed.data.kind === 'email') {
    if (!u.notifyEmail) {
      return NextResponse.json(
        {
          ok: false,
          kind: 'email',
          error: 'notify_email not set — fill the recipient and save first.',
        },
        { status: 400 },
      )
    }
    const input = {
      to: u.notifyEmail,
      subject: 'GigaWork — test email',
      body_markdown: TEST_BODY_MD,
      api_key: u.emailApiKey ?? undefined,
      from: u.emailFrom ?? undefined,
    }
    const r = await fetch(`${selfBaseUrl(req)}/api/skills/email-sender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const j = (await r.json()) as Record<string, unknown>
    return NextResponse.json({ ok: j.sent === true, kind: 'email', ...j })
  }

  // kind === 'telegram'
  if (!u.telegramBotToken) {
    return NextResponse.json(
      {
        ok: false,
        kind: 'telegram',
        error: 'Telegram Bot Token not configured. Please fill it and save first.',
      },
      { status: 400 },
    )
  }
  const input = {
    chat_id: u.telegramChatId ?? undefined,
    message: TEST_TG,
    parse_mode: 'Markdown',
    bot_token: u.telegramBotToken,
    userId: u.id, // also pass userId so the skill handler itself can auto-save if it detects
  }
  const r = await fetch(`${selfBaseUrl(req)}/api/skills/telegram-sender`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = (await r.json()) as Record<string, unknown>

  // If the skill successfully sent the message and auto-detected a chat ID, save it to the DB!
  if (j.sent === true && typeof j.chat_id === 'string' && j.chat_id) {
    const botId = u.telegramBotToken.split(':')[0]
    if (!u.telegramChatId || u.telegramChatId === botId || u.telegramChatId !== j.chat_id) {
      console.log(`[profile/test] auto-saving detected telegramChatId: ${j.chat_id}`)
      try {
        await db.update(users).set({ telegramChatId: j.chat_id }).where(eq(users.id, u.id))
      } catch (dbErr) {
        console.error('[profile/test] failed to auto-save detected telegramChatId', dbErr)
      }
    }
  }

  return NextResponse.json({ ok: j.sent === true, kind: 'telegram', ...j })
}

/** Resolve our own origin so we can call our own API in dev + prod. */
function selfBaseUrl(req: Request): string {
  const url = new URL(req.url)
  return `${url.protocol}//${url.host}`
}
