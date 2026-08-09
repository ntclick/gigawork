import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { workflows, deployments, users } from '@/lib/db/schema'
import { encryptProfileSecret } from '@/lib/notifications/secrets'

type RouteCtx = { params: Promise<{ id: string }> }

const BodySchema = z.object({
  cronExpression: z.string().default('*/30 * * * *'),
  // Notification channels: 'none' | 'email' | 'telegram' | 'both'
  notifyChannels: z.enum(['none', 'email', 'telegram', 'both']).default('none'),
  // Optional per-deployment overrides (null = use user's profile settings)
  notifyEmail: z.string().email().optional().nullable(),
  notifyTelegramId: z.string().optional().nullable(),
  // Legacy fields from previous version — still accepted, mapped to notifyChannels
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
})

export async function POST(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params

  let u
  try {
    u = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  // Parse body
  const body = await req.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const {
    cronExpression,
    notifyChannels,
    notifyEmail,
    notifyTelegramId,
    telegramBotToken,
    telegramChatId,
  } = parsed.data

  // Fetch workflow and verify ownership
  const [wf] = await withDbRetry(
    () => db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, u.id)))
      .limit(1),
    { label: 'workflow-deploy:get-wf' }
  )

  if (!wf) {
    return NextResponse.json({ error: 'workflow_not_found' }, { status: 404 })
  }

  // If legacy telegram credentials provided (from old DeployModal), save them
  // to the users table and promote notifyChannels to 'telegram' if not set.
  // The bot token is encrypted at rest — see lib/notifications/secrets.ts.
  // This is the second (legacy) write boundary for that column; the main
  // one is /api/me/profile.
  if (telegramBotToken && telegramChatId) {
    await withDbRetry(
      () => db
        .update(users)
        .set({ telegramBotToken: encryptProfileSecret(telegramBotToken), telegramChatId })
        .where(eq(users.id, u.id)),
      { label: 'workflow-deploy:save-telegram-legacy' }
    ).catch(() => {})
  }

  // Check if a deployment already exists for this workflow
  const [existing] = await withDbRetry(
    () => db
      .select()
      .from(deployments)
      .where(and(eq(deployments.workflowId, id), eq(deployments.userId, u.id)))
      .limit(1),
    { label: 'workflow-deploy:get-existing' }
  )

  const base = { cronExpression, status: 'active', notifyChannels }

  // Distinguish "key absent" (leave the stored override alone) from
  // "explicitly null" (clear it). Zod strips absent optional keys, so we
  // check the raw body. Previously both branches wrote
  // `notifyEmail ?? null` unconditionally, which meant ANY redeploy —
  // e.g. changing only the cron — silently wiped a per-deployment
  // notification target that had been configured earlier.
  const sentEmail = Object.prototype.hasOwnProperty.call(body, 'notifyEmail')
  const sentTelegram = Object.prototype.hasOwnProperty.call(body, 'notifyTelegramId')

  let result
  if (existing) {
    ;[result] = await withDbRetry(
      () => db
        .update(deployments)
        .set({
          ...base,
          ...(sentEmail ? { notifyEmail: notifyEmail ?? null } : {}),
          ...(sentTelegram ? { notifyTelegramId: notifyTelegramId ?? null } : {}),
        })
        .where(eq(deployments.id, existing.id))
        .returning(),
      { label: 'workflow-deploy:update' }
    )
  } else {
    ;[result] = await withDbRetry(
      () => db
        .insert(deployments)
        .values({
          workflowId: id,
          userId: u.id,
          ...base,
          notifyEmail: notifyEmail ?? null,
          notifyTelegramId: notifyTelegramId ?? null,
        })
        .returning(),
      { label: 'workflow-deploy:insert' }
    )
  }

  console.log(
    `[Hermes] Registered/updated cron job for workflow ${id}` +
    ` (User: ${u.id}, Cron: ${cronExpression}, Notify: ${notifyChannels})`
  )

  return NextResponse.json({
    success: true,
    deployment: result,
    notify: notifyChannels,
  })
}
