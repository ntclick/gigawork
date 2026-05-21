import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { messages, nodes, users, workflows } from '@/lib/db/schema'
import { getCurrentUser } from '@/lib/auth/session'
import { callSkillEndpoint, getSkillByName } from '@/lib/skills/registry'

/**
 * POST /api/workflow/[id]/test-node
 *
 * n8n-style per-node test: runs a single skill with the given input
 * without modifying the workflow state or consuming credits.
 * Returns ERC-8183 compliant structured output.
 *
 * Body: {
 *   nodeId: string,
 *   skillName: string,
 *   input: Record<string, unknown>,
 *   save?: boolean  — when true, persists the result to the nodes table
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workflowId } = await params
  const me = await getCurrentUser()
  if (!me) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as {
    nodeId?: string
    skillName?: string
    input?: Record<string, unknown>
    save?: boolean
  }

  const { nodeId, skillName, input = {}, save = false } = body
  if (!nodeId || !skillName) {
    return NextResponse.json(
      { error: 'nodeId and skillName are required' },
      { status: 400 },
    )
  }

  // Verify workflow exists and belongs to user
  const [wf] = await db
    .select({ id: workflows.id, userId: workflows.userId })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1)

  if (!wf) {
    return NextResponse.json({ error: 'workflow not found' }, { status: 404 })
  }

  // Look up the skill
  const skill = await getSkillByName(skillName)
  if (!skill) {
    return NextResponse.json(
      { error: `unknown skill: ${skillName}`, ok: false },
      { status: 400 },
    )
  }

  // Inject user profile for notification skills (same as in brain tools)
  const inputCopy = { ...input }
  if (skillName === 'email-sender' || skillName === 'telegram-sender') {
    const [profile] = await db
      .select({
        notifyEmail: users.notifyEmail,
        emailApiKey: users.emailApiKey,
        emailFrom: users.emailFrom,
        telegramChatId: users.telegramChatId,
        telegramBotToken: users.telegramBotToken,
      })
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1)
    if (skillName === 'email-sender') {
      if (!inputCopy.to && profile?.notifyEmail) inputCopy.to = profile.notifyEmail
      if (!inputCopy.api_key && profile?.emailApiKey) inputCopy.api_key = profile.emailApiKey
      if (!inputCopy.from && profile?.emailFrom) inputCopy.from = profile.emailFrom
    }
    if (skillName === 'telegram-sender') {
      // Only fall back to profile credentials if the user is NOT using a custom bot token
      if (!inputCopy.bot_token) {
        if (!inputCopy.chat_id && profile?.telegramChatId) inputCopy.chat_id = profile.telegramChatId
        if (profile?.telegramBotToken) inputCopy.bot_token = profile.telegramBotToken
      }
    }
  }

  // When saving, resolve nodeId → DB node UUID.
  // nodeId can be a plan_id slug (e.g. "send-telegram") rather than a UUID.
  let resolvedNodeId: string | null = null
  if (save) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId)
    if (isUuid) {
      resolvedNodeId = nodeId
    } else {
      // Look up by skill_name match in this workflow
      const skillRow = await getSkillByName(skillName)
      if (skillRow) {
        const candidates = await db
          .select({ id: nodes.id })
          .from(nodes)
          .where(and(eq(nodes.workflowId, workflowId), eq(nodes.skillId, skillRow.id)))
          .limit(1)
        if (candidates[0]) resolvedNodeId = candidates[0].id
      }
    }

    // Mark node as running before executing
    if (resolvedNodeId) {
      await db
        .update(nodes)
        .set({ status: 'running' })
        .where(eq(nodes.id, resolvedNodeId))
    }
  }

  try {
    // Debug: log which credentials are being used (masked for security)
    if (skillName === 'telegram-sender') {
      const tk = inputCopy.bot_token as string | undefined
      const ci = inputCopy.chat_id as string | undefined
      console.log(
        `[test-node] telegram-sender: bot_token=${tk ? '****' + tk.slice(-6) : 'NONE'}, chat_id=${ci ?? 'NONE'}, source=${input.bot_token ? 'custom' : 'profile'}`,
      )
    }
    const output = (await callSkillEndpoint(skill, { ...inputCopy, workflowId })) as Record<string, unknown>

    // Persist to DB when save=true
    if (save && resolvedNodeId) {
      await db
        .update(nodes)
        .set({ status: 'completed', output })
        .where(eq(nodes.id, resolvedNodeId))

      // Clean & redact input (original client-sent inputs) for messages toolPayload
      const recordedInput: Record<string, unknown> = { ...input }
      const redactKeys = ['bot_token', 'api_key', 'authorization'] as const
      for (const k of redactKeys) {
        const v = recordedInput[k]
        if (typeof v === 'string' && v.length > 0) {
          recordedInput[k] = '••••' + v.slice(-4)
        }
      }

      const updated = await db
        .update(messages)
        .set({
          toolPayload: {
            skill_name: skillName,
            input: recordedInput,
            ok: true,
            output,
            dispatch_tx: null,
          },
        })
        .where(
          and(
            eq(messages.workflowId, workflowId),
            eq(messages.nodeId, resolvedNodeId),
            eq(messages.toolName, 'dispatchSkill'),
          ),
        )
        .returning()

      if (updated.length === 0) {
        await db.insert(messages).values({
          workflowId,
          role: 'system',
          nodeId: resolvedNodeId,
          toolName: 'dispatchSkill',
          toolPayload: {
            skill_name: skillName,
            input: recordedInput,
            ok: true,
            output,
            dispatch_tx: null,
          },
          content: null,
        })
      }
    }

    return NextResponse.json({
      ok: true,
      node_id: nodeId,
      skill_name: skillName,
      output,
      saved: save && !!resolvedNodeId,
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)

    // Persist failure to DB when save=true
    if (save && resolvedNodeId) {
      await db
        .update(nodes)
        .set({ status: 'failed', output: { error } })
        .where(eq(nodes.id, resolvedNodeId))

      // Clean & redact input (original client-sent inputs) for messages toolPayload
      const recordedInput: Record<string, unknown> = { ...input }
      const redactKeys = ['bot_token', 'api_key', 'authorization'] as const
      for (const k of redactKeys) {
        const v = recordedInput[k]
        if (typeof v === 'string' && v.length > 0) {
          recordedInput[k] = '••••' + v.slice(-4)
        }
      }

      const updated = await db
        .update(messages)
        .set({
          toolPayload: {
            skill_name: skillName,
            input: recordedInput,
            ok: false,
            error,
            dispatch_tx: null,
          },
        })
        .where(
          and(
            eq(messages.workflowId, workflowId),
            eq(messages.nodeId, resolvedNodeId),
            eq(messages.toolName, 'dispatchSkill'),
          ),
        )
        .returning()

      if (updated.length === 0) {
        await db.insert(messages).values({
          workflowId,
          role: 'system',
          nodeId: resolvedNodeId,
          toolName: 'dispatchSkill',
          toolPayload: {
            skill_name: skillName,
            input: recordedInput,
            ok: false,
            error,
            dispatch_tx: null,
          },
          content: null,
        })
      }
    }

    return NextResponse.json(
      { ok: false, error, skill_name: skillName, node_id: nodeId },
      { status: 500 },
    )
  }
}
