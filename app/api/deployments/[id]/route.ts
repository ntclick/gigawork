import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { deployments } from '@/lib/db/schema'

type RouteCtx = { params: Promise<{ id: string }> }

// POST /api/deployments/[id] - Toggle status between active and paused
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

  // Get current deployment row to check ownership and status
  const [existing] = await withDbRetry(
    () => db
      .select()
      .from(deployments)
      .where(and(eq(deployments.id, id), eq(deployments.userId, u.id)))
      .limit(1),
    { label: 'deployments:get-existing-for-toggle' }
  )

  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Toggle status
  const newStatus = existing.status === 'active' ? 'paused' : 'active'

  const [updated] = await withDbRetry(
    () => db
      .update(deployments)
      .set({ status: newStatus })
      .where(eq(deployments.id, id))
      .returning(),
    { label: 'deployments:toggle' }
  )

  console.log(`[Hermes] Toggled deployment ${id} status to ${newStatus}`)

  return NextResponse.json({
    success: true,
    deployment: updated,
  })
}

// DELETE /api/deployments/[id] - Delete deployment
export async function DELETE(req: Request, ctx: RouteCtx) {
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

  // Verify ownership
  const [existing] = await withDbRetry(
    () => db
      .select()
      .from(deployments)
      .where(and(eq(deployments.id, id), eq(deployments.userId, u.id)))
      .limit(1),
    { label: 'deployments:get-existing-for-delete' }
  )

  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  await withDbRetry(
    () => db
      .delete(deployments)
      .where(eq(deployments.id, id)),
    { label: 'deployments:delete' }
  )

  console.log(`[Hermes] Deleted/Unregistered deployment ${id}`)

  return NextResponse.json({
    success: true,
  })
}
