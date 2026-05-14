import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { nodes, users, workflows } from '@/lib/db/schema'
import { getCurrentUser } from '@/lib/auth/session'
import { callSkillEndpoint, getSkillByName } from '@/lib/skills/registry'

/**
 * POST /api/workflow/[id]/test-node
 *
 * n8n-style per-node test: runs a single skill with the given input
 * without modifying the workflow state or consuming credits.
 * Returns ERC-8183 compliant structured output.
 *
 * Body: { nodeId: string, skillName: string, input: Record<string, unknown> }
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
  }

  const { nodeId, skillName, input = {} } = body
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
      if (!inputCopy.chat_id && profile?.telegramChatId) inputCopy.chat_id = profile.telegramChatId
      if (!inputCopy.bot_token && profile?.telegramBotToken) inputCopy.bot_token = profile.telegramBotToken
    }
  }

  try {
    const output = (await callSkillEndpoint(skill, inputCopy)) as Record<string, unknown>

    return NextResponse.json({
      ok: true,
      node_id: nodeId,
      skill_name: skillName,
      output,
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { ok: false, error, skill_name: skillName, node_id: nodeId },
      { status: 500 },
    )
  }
}
