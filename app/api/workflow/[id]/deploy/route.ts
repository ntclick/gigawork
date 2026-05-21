import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { workflows, deployments } from '@/lib/db/schema'

type RouteCtx = { params: Promise<{ id: string }> }

const BodySchema = z.object({
  cronExpression: z.string().default('*/30 * * * *'),
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
  const { cronExpression } = parsed.data

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

  // Check if a deployment already exists for this workflow
  const [existing] = await withDbRetry(
    () => db
      .select()
      .from(deployments)
      .where(and(eq(deployments.workflowId, id), eq(deployments.userId, u.id)))
      .limit(1),
    { label: 'workflow-deploy:get-existing' }
  )

  let result
  if (existing) {
    // Update existing deployment
    [result] = await withDbRetry(
      () => db
        .update(deployments)
        .set({
          cronExpression,
          status: 'active',
          createdAt: new Date(),
        })
        .where(eq(deployments.id, existing.id))
        .returning(),
      { label: 'workflow-deploy:update' }
    )
  } else {
    // Insert new deployment
    [result] = await withDbRetry(
      () => db
        .insert(deployments)
        .values({
          workflowId: id,
          userId: u.id,
          cronExpression,
          status: 'active',
        })
        .returning(),
      { label: 'workflow-deploy:insert' }
    )
  }

  console.log(`[Hermes] Registered/updated cron job for workflow ${id} (User: ${u.id}, Cron: ${cronExpression})`)

  return NextResponse.json({
    success: true,
    deployment: result,
  })
}
