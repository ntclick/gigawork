import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { messages, nodes, skills, users } from '@/lib/db/schema'
import { callSkillEndpoint } from '@/lib/skills/registry'
import { chargeCredits, InsufficientCreditsError } from '@/lib/credits/service'
import { failWorkflow, publishFinalReport } from '@/lib/ai/finalizeWorkflow'
import { withTimeout } from '@/lib/workflow/timing'
import { workflowRuntimeConfig } from '@/lib/workflow/runtimeConfig'

export async function executeWorkflowRun({ workflowId, userId }: { workflowId: string; userId: string }) {
  console.log(`[executor:${workflowId}] Starting parallel DAG execution...`)

  // 1. Fetch all planned nodes
  const allNodes = await db.select().from(nodes).where(eq(nodes.workflowId, workflowId))
  if (allNodes.length === 0) {
    console.error(`[executor:${workflowId}] No nodes planned for this workflow.`)
    await failWorkflow(workflowId, userId)
    return
  }

  // 2. Fetch the plan message mapping plan_id (slug) to node_id (UUID)
  const [planMsg] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.workflowId, workflowId), eq(messages.toolName, 'planWorkflow')))
    .limit(1)

  const planToNodeId = new Map<string, string>()
  if (planMsg && typeof planMsg.toolPayload === 'object' && planMsg.toolPayload !== null) {
    const payload = planMsg.toolPayload as { output?: { nodes?: { plan_id: string; node_id: string }[] } } | null
    const nodesList = payload?.output?.nodes || []
    for (const n of nodesList) {
      planToNodeId.set(n.plan_id, n.node_id)
    }
  } else {
    console.warn(`[executor:${workflowId}] Could not load planWorkflow payload, building mapping fallback...`)
    for (const n of allNodes) {
      const fallbackSlug = n.label.toLowerCase().replace(/[^a-z0-9]/g, '-') || n.id
      planToNodeId.set(fallbackSlug, n.id)
    }
  }

  // Reset all failed/pending nodes to pending to allow re-runs
  await db
    .update(nodes)
    .set({ status: 'pending', output: null, startedAt: null, completedAt: null, timing: null })
    .where(and(eq(nodes.workflowId, workflowId), inArray(nodes.status, ['failed', 'pending'])))

  const maxParallel = workflowRuntimeConfig.maxParallelNodes || 5
  const activeExecutions = new Map<string, Promise<void>>()

  while (true) {
    const currentNodes = await db.select().from(nodes).where(eq(nodes.workflowId, workflowId))

    const allFinished = currentNodes.every((n) => n.status === 'completed' || n.status === 'failed')
    if (allFinished) {
      break
    }

    // Find ready nodes: status is 'pending', not currently executing, and ALL dependencies (in dependsOn) are completed
    const readyNodes = currentNodes.filter((n) => {
      if (n.status !== 'pending') return false
      if (activeExecutions.has(n.id)) return false

      const deps = n.dependsOn || []
      return deps.every((depSlug) => {
        const depUuid = planToNodeId.get(depSlug)
        if (!depUuid) return true
        const depNode = currentNodes.find((x) => x.id === depUuid)
        return depNode && depNode.status === 'completed'
      })
    })

    // Start up to capacity
    let startedAny = false
    for (const node of readyNodes) {
      if (activeExecutions.size >= maxParallel) {
        break
      }

      const promise = executeSingleNodeParallel({
        nodeId: node.id,
        planToNodeId,
        workflowId,
        userId,
      }).finally(() => {
        activeExecutions.delete(node.id)
      })

      activeExecutions.set(node.id, promise)
      startedAny = true
    }

    if (startedAny) {
      // Loop again immediately to see if we have more capacity and ready nodes
      continue
    }

    if (activeExecutions.size > 0) {
      // Wait for at least one active execution to complete before checking state again
      await Promise.race(activeExecutions.values())
      // Small tick to ensure DB writes from .finally or the promise are settled
      await new Promise((r) => setTimeout(r, 100))
      continue
    }

    // If we are here, there are no active executions and we couldn't start any ready nodes,
    // but not all nodes are finished. This is a deadlock (e.g. dependency failed or skipped).
    const pendingNodes = currentNodes.filter((n) => n.status === 'pending')
    for (const pn of pendingNodes) {
      await db
        .update(nodes)
        .set({ status: 'failed', output: { error: 'Skipped: dependency failed or skipped' } })
        .where(eq(nodes.id, pn.id))
    }
    break
  }

  // 4. Finalize Workflow Report
  const finalNodes = await db
    .select({ id: nodes.id, status: nodes.status, output: nodes.output, skillId: nodes.skillId })
    .from(nodes)
    .where(eq(nodes.workflowId, workflowId))

  const hasFailures = finalNodes.some((n) => n.status === 'failed')

  // Try to find if a report was composed
  const skillRows = await db.query.skills.findMany()
  const skillMap = new Map(skillRows.map((s) => [s.id, s.name]))
  const composerCompleted = finalNodes.find(
    (n) =>
      n.status === 'completed' &&
      (skillMap.get(n.skillId ?? '') === 'report-composer' ||
        skillMap.get(n.skillId ?? '') === 'report-composer-fast')
  )

  if (composerCompleted && composerCompleted.output) {
    const out = composerCompleted.output as { markdown?: string; summary_markdown?: string; evidence_markdown?: string } | null
    const markdown = out?.markdown || out?.summary_markdown || out?.evidence_markdown || ''
    if (markdown) {
      await publishFinalReport({
        workflowId,
        userId,
        finalMarkdown: markdown,
        rawJson: { nodes: finalNodes.map((n) => ({ id: n.id, skill: skillMap.get(n.skillId ?? ''), status: n.status })) },
        toolName: 'auto_finalize',
      })
      console.log(`[executor:${workflowId}] Workflow completed successfully. Report published.`)
      return
    }
  }

  if (hasFailures) {
    await failWorkflow(workflowId, userId)
    console.log(`[executor:${workflowId}] Workflow failed due to node failures.`)
  } else {
    // All succeeded but report-composer/report-composer-fast did not run or produce output. Build deterministic fallback report.
    const rawJson: Record<string, unknown> = {}
    for (const n of finalNodes) {
      const skillName = skillMap.get(n.skillId ?? '') || 'unknown'
      rawJson[skillName] = n.output
    }
    const fallbackMarkdown = buildDeterministicFinalReport(rawJson)
    await publishFinalReport({
      workflowId,
      userId,
      finalMarkdown: fallbackMarkdown,
      rawJson,
      toolName: 'auto_finalize',
    })
    console.log(`[executor:${workflowId}] Workflow finished. Fallback report published.`)
  }
}

async function executeSingleNodeParallel(opts: {
  nodeId: string
  planToNodeId: Map<string, string>
  workflowId: string
  userId: string
}) {
  const { nodeId, planToNodeId, workflowId, userId } = opts

  const startedAt = new Date()

  // Mark running
  await db
    .update(nodes)
    .set({ status: 'running', startedAt })
    .where(eq(nodes.id, nodeId))

  // Fetch node row to get planned inputs and skill details
  const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
  if (!node) {
    console.error(`[executor:${workflowId}] Node ${nodeId} not found in DB.`)
    return
  }

  const skill = await db.query.skills.findFirst({
    where: eq(skills.id, node.skillId ?? ''),
  })

  if (!skill) {
    const completedAt = new Date()
    await db
      .update(nodes)
      .set({
        status: 'failed',
        completedAt,
        timing: { durationMs: completedAt.getTime() - startedAt.getTime() },
        output: { error: 'Associated Agent Skill not found in registry' },
      })
      .where(eq(nodes.id, nodeId))
    return
  }

  console.log(`[executor:${workflowId}] Running node ${nodeId} (${skill.name})...`)

  // 1. Gather parent outputs
  const parentOutputs: Record<string, unknown> = {}
  const currentNodes = await db.select().from(nodes).where(eq(nodes.workflowId, workflowId))
  const deps = node.dependsOn || []
  for (const depSlug of deps) {
    const depUuid = planToNodeId.get(depSlug)
    if (depUuid) {
      const depNode = currentNodes.find((x) => x.id === depUuid)
      if (depNode && depNode.status === 'completed') {
        parentOutputs[depSlug] = depNode.output
      }
    }
  }

  // 2. Build deterministic handover dialogue (No LLM call!)
  const skillIcons: Record<string, string> = {
    'crypto-scanner': '🔍',
    'whale-tracker': '🐳',
    'trading-signals': '📈',
    'social-sentiment': '💬',
    'defi-yields': '🌾',
    'web-intel': '🌐',
    'document-digest': '📄',
    'dca-executor': '📊',
    'polymarket-pulse': '🔮',
    'nft-floor-watch': '🖼️',
    'report-composer': '✍️',
    'email-sender': '✉️',
    'telegram-sender': '🤖',
    'market-data-bundle': '📊',
    'social-lite-bundle': '💬',
    'report-composer-fast': '⚡',
  }
  const icon = skillIcons[skill.name] || '🤖'
  const agentLabel = node.label || skill.name
  let dialogueText = ''
  if (deps.length > 0) {
    dialogueText = `${icon} **${agentLabel} Agent:** Initializing execution. Dependencies completed: ${deps.join(', ')}. Aggregating input data to proceed.`
  } else {
    dialogueText = `${icon} **${agentLabel} Agent:** Dispatching task from orchestrator engine.`
  }

  // Log typewriter dialogue as a role: 'brain' message
  await db.insert(messages).values({
    workflowId,
    role: 'brain',
    nodeId,
    content: dialogueText,
  })

  // 3. Charge credits
  const manifest = (skill.manifest ?? {}) as Record<string, unknown>
  const cost = Math.max(0, Math.round((manifest.cost_credits as number) ?? 5))

  if (userId && cost > 0) {
    try {
      await chargeCredits({
        userId,
        amount: cost,
        reason: `dispatch:${skill.name}`,
        workflowId,
      })
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        const errMsg = `Please top up credits to proceed (Requires ${cost} cr, currently have ${err.have} cr).`
        const completedAt = new Date()
        await db
          .update(nodes)
          .set({
            status: 'failed',
            completedAt,
            timing: { durationMs: completedAt.getTime() - startedAt.getTime() },
            output: { error: 'insufficient_credits', need: cost, have: err.have },
          })
          .where(eq(nodes.id, nodeId))

        await db.insert(messages).values({
          workflowId,
          role: 'brain',
          nodeId,
          content: `❌ **System:** Insufficient credits to run Agent **${skill.name}**. ${errMsg}`,
        })
        return
      }
      throw err
    }
  }

  // 4. Inject profile credentials
  const inputParams = { ...((node.input as Record<string, unknown> | null) ?? {}) }

  if (userId && (skill.name === 'email-sender' || skill.name === 'telegram-sender')) {
    const [profile] = await db
      .select({
        notifyEmail: users.notifyEmail,
        emailApiKey: users.emailApiKey,
        emailFrom: users.emailFrom,
        telegramChatId: users.telegramChatId,
        telegramBotToken: users.telegramBotToken,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (skill.name === 'email-sender') {
      if (!inputParams.to && profile?.notifyEmail) inputParams.to = profile.notifyEmail
      if (!inputParams.api_key && profile?.emailApiKey) inputParams.api_key = profile.emailApiKey
      if (!inputParams.from && profile?.emailFrom) inputParams.from = profile.emailFrom
    }
    if (skill.name === 'telegram-sender') {
      if (!inputParams.bot_token && profile?.telegramBotToken) inputParams.bot_token = profile.telegramBotToken
      if (!inputParams.chat_id && profile?.telegramChatId) inputParams.chat_id = profile.telegramChatId
      inputParams.userId = userId
    }
  }

  // 5. If this is report-composer or report-composer-fast, inject parent outputs
  if (skill.name === 'report-composer' || skill.name === 'report-composer-fast') {
    inputParams.data = parentOutputs
  }

  // Determine Timeout Limit
  let timeoutLimit = workflowRuntimeConfig.nodeTimeoutMs || 8_000
  if (skill.name === 'market-data-bundle' || skill.name === 'social-lite-bundle') {
    timeoutLimit = workflowRuntimeConfig.bundleTimeoutMs || 12_000
  } else if (skill.name === 'report-composer-fast') {
    timeoutLimit = workflowRuntimeConfig.composerTimeoutMs || 8_000
  }

  // 6. Execute the skill call
  try {
    const output = await withTimeout(skill.name, timeoutLimit, async () => {
      return (await callSkillEndpoint(skill, inputParams, { workflowId, nodeId })) as Record<string, unknown>
    })

    const completedAt = new Date()

    // Complete node
    await db
      .update(nodes)
      .set({
        status: 'completed',
        completedAt,
        timing: { durationMs: completedAt.getTime() - startedAt.getTime() },
        output,
      })
      .where(eq(nodes.id, nodeId))

    // Redact sensitive credentials for log message
    const recordedInput = { ...inputParams }
    const redactKeys = ['bot_token', 'api_key', 'authorization'] as const
    for (const k of redactKeys) {
      if (typeof recordedInput[k] === 'string') {
        recordedInput[k] = '••••' + (recordedInput[k] as string).slice(-4)
      }
    }

    // Persist system log message
    await db.insert(messages).values({
      workflowId,
      role: 'system',
      nodeId,
      toolName: 'dispatchSkill',
      toolPayload: {
        skill_name: skill.name,
        input: recordedInput,
        output,
      },
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const completedAt = new Date()

    await db
      .update(nodes)
      .set({
        status: 'failed',
        completedAt,
        timing: { durationMs: completedAt.getTime() - startedAt.getTime() },
        output: { error },
      })
      .where(eq(nodes.id, nodeId))

    // Log failure message
    await db.insert(messages).values({
      workflowId,
      role: 'system',
      nodeId,
      toolName: 'dispatchSkill',
      toolPayload: {
        skill_name: skill.name,
        input: inputParams,
        error,
        ok: false,
      },
    })

    await db.insert(messages).values({
      workflowId,
      role: 'brain',
      nodeId,
      content: `❌ **${skill.name} Agent:** Error encountered during execution: \`${error}\`.`,
    })
  }
}

function buildDeterministicFinalReport(raw: Record<string, unknown>): string {
  const entries = Object.entries(raw)
  return [
    '# Automated Workflow Report',
    '',
    '## Agent Executions',
    ...entries.map(([key, val]) => `### Agent ${key}\n- Status: completed.\n- Output Summary: ${JSON.stringify(val).slice(0, 300)}...`),
    '',
    `Completed at: ${new Date().toUTCString()}`,
  ].join('\n')
}
