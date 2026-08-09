/**
 * GET /api/me/profile/notify-status
 *
 * Returns a lightweight summary of which notification channels are
 * ready for the current user. Used by DeployModal to show channel
 * readiness without exposing raw credentials.
 */
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export async function GET() {
  let u
  try {
    u = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  const [row] = await db
    .select({
      notifyEmail: users.notifyEmail,
      emailApiKey: users.emailApiKey,
      emailFrom: users.emailFrom,
      telegramBotToken: users.telegramBotToken,
      telegramChatId: users.telegramChatId,
    })
    .from(users)
    .where(eq(users.id, u.id))
    .limit(1)

  if (!row) {
    return NextResponse.json({ hasEmail: false, hasTelegram: false })
  }

  const hasEmail = !!(row.notifyEmail && row.emailApiKey)
  const hasTelegram = !!(row.telegramBotToken)

  return NextResponse.json({
    hasEmail,
    hasTelegram,
    // Return partial info (not full credentials) for UI hints
    emailAddress: row.notifyEmail ?? null,
    emailFrom: row.emailFrom ?? null,
    telegramChatId: row.telegramChatId ?? null,
  })
}
