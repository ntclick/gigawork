import { NextResponse } from 'next/server'
import { and, eq, desc } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { deployments, nodes, workflows, skills, messages } from '@/lib/db/schema'
import { streamBrain } from '@/lib/ai/brain'

type RouteCtx = { params: Promise<{ id: string }> }

/**
 * POST /api/deployments/[id]/test
 *
 * Resets the workflow run state, executes the workflow via streamBrain,
 * drains the stream, and returns the final node outputs.
 */
export async function POST(_req: Request, ctx: RouteCtx) {
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

  // Find deployment & verify ownership
  const [dep] = await withDbRetry(
    () => db
      .select()
      .from(deployments)
      .where(and(eq(deployments.id, id), eq(deployments.userId, u.id)))
      .limit(1),
    { label: 'test-deploy:get' }
  )
  if (!dep) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Get workflow info
  const [wf] = await withDbRetry(
    () => db
      .select()
      .from(workflows)
      .where(eq(workflows.id, dep.workflowId))
      .limit(1),
    { label: 'test-deploy:wf' }
  )
  if (!wf) {
    return NextResponse.json({ error: 'workflow_not_found' }, { status: 404 })
  }

  // 1. Clear previous run state for this workflow
  await withDbRetry(
    async () => {
      await db.delete(nodes).where(eq(nodes.workflowId, dep.workflowId))
      await db.delete(messages).where(eq(messages.workflowId, dep.workflowId))
    },
    { label: 'test-deploy:clear-state' }
  )

  // 2. Set workflow status to 'running'
  await withDbRetry(
    () => db
      .update(workflows)
      .set({ status: 'running' })
      .where(eq(workflows.id, dep.workflowId)),
    { label: 'test-deploy:set-running' }
  )

  // 3. Insert initial user message containing the workflow prompt
  await withDbRetry(
    () => db.insert(messages).values({
      workflowId: dep.workflowId,
      role: 'user',
      content: wf.prompt,
    }),
    { label: 'test-deploy:insert-seed' }
  )

  // 4. Run streamBrain and drain the stream synchronously so we have the final output
  try {
    const result = await streamBrain({
      workflowId: dep.workflowId,
      userId: u.id,
      uiMessages: [
        { id: 'seed', role: 'user', parts: [{ type: 'text', text: wf.prompt }] },
      ],
    })
    const stream = result.toUIMessageStream()
    const reader = stream.getReader()
    const t0 = Date.now()
    while (true) {
      const { done } = await reader.read()
      if (done) break
      // Max 100 seconds execution safeguard
      if (Date.now() - t0 > 100_000) break
    }
  } catch (err) {
    console.error(`[test-deploy] streamBrain failed for workflow ${dep.workflowId}:`, err)
    // Mark as failed if streamBrain threw an exception
    await withDbRetry(
      () => db
        .update(workflows)
        .set({ status: 'failed' })
        .where(eq(workflows.id, dep.workflowId)),
      { label: 'test-deploy:mark-failed' }
    )
  }

  // Get the updated workflow details
  const [updatedWf] = await withDbRetry(
    () => db
      .select()
      .from(workflows)
      .where(eq(workflows.id, dep.workflowId))
      .limit(1),
    { label: 'test-deploy:get-updated-wf' }
  )

  // Get all nodes with their outputs
  const nodeList = await withDbRetry(
    () => db
      .select({
        id: nodes.id,
        label: nodes.label,
        kind: nodes.kind,
        status: nodes.status,
        output: nodes.output,
        skillId: nodes.skillId,
        createdAt: nodes.createdAt,
      })
      .from(nodes)
      .where(eq(nodes.workflowId, dep.workflowId))
      .orderBy(desc(nodes.createdAt)),
    { label: 'test-deploy:nodes' }
  )

  // Resolve skill names for nodes that have skills
  const skillIds = nodeList.map((n) => n.skillId).filter(Boolean) as string[]
  let skillMap: Record<string, string> = {}
  if (skillIds.length > 0) {
    const skillRows = await withDbRetry(
      () => db
        .select({ id: skills.id, name: skills.name })
        .from(skills),
      { label: 'test-deploy:skills' }
    )
    skillMap = Object.fromEntries(skillRows.map((s) => [s.id, s.name]))
  }

  // Build node results
  const nodeResults = nodeList.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    status: n.status,
    skillName: n.skillId ? skillMap[n.skillId] ?? null : null,
    output: n.output,
  }))

  return NextResponse.json({
    workflow: {
      id: updatedWf?.id ?? wf.id,
      prompt: updatedWf?.prompt ?? wf.prompt,
      status: updatedWf?.status ?? wf.status,
    },
    deployment: {
      id: dep.id,
      cronExpression: dep.cronExpression,
      status: dep.status,
    },
    nodeResults,
    testedAt: new Date().toISOString(),
  })
}
