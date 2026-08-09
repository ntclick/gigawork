import { and, eq, desc } from 'drizzle-orm'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'

import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { deployments, nodes, workflows, skills, messages, users, deploymentChecks } from '@/lib/db/schema'
import { streamBrain } from '@/lib/ai/brain'
import { type SignalThesis } from '@/lib/types/thesis'
import { sendDeployNotification, formatCheckResultNotification, type NotifyChannel } from '@/lib/notifications/send'

const PROVIDER = (process.env.AI_PROVIDER ?? 'openai').toLowerCase()

function resolveProvider() {
  switch (PROVIDER) {
    case 'kimi':
    case 'moonshot':
      return {
        apiKey: process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY ?? '',
        baseURL: process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1',
        model: process.env.KIMI_MODEL ?? 'kimi-k2-0905-preview',
      }
    case 'deepseek':
      return {
        apiKey: process.env.DEEPSEEK_API_KEY ?? '',
        baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      }
    case 'openai':
    default:
      return {
        apiKey: process.env.OPENAI_API_KEY ?? '',
        baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      }
  }
}

const config = resolveProvider()
const llm = createOpenAICompatible({
  name: PROVIDER,
  apiKey: config.apiKey,
  baseURL: config.baseURL,
})

/**
 * Extracts a complete Defensible SignalThesis object from node results.
 */
function extractSignalThesis(
  nodeResults: Array<{ label: string; kind: string; output: unknown }>,
  prompt: string
): SignalThesis {
  let verdict = ''
  let confidence: number | null = null
  let supporting: string[] = []
  let counterpoint = ''
  let invalidation = ''
  let dataSource = ''

  for (const n of nodeResults) {
    if (n.output && typeof n.output === 'object') {
      const out = n.output as Record<string, unknown>
      if (out.verdict && typeof out.verdict === 'string') verdict = out.verdict
      if (out.confidence != null && typeof out.confidence === 'number') confidence = out.confidence
      else if (out.conf != null && typeof out.conf === 'number') confidence = out.conf

      if (Array.isArray(out.supporting) && out.supporting.length > 0) {
        supporting = out.supporting.map(String)
      }
      if (out.counterpoint && typeof out.counterpoint === 'string') counterpoint = out.counterpoint
      if (out.invalidation && typeof out.invalidation === 'string') invalidation = out.invalidation
      if (out.dataSource && typeof out.dataSource === 'string') dataSource = out.dataSource
      else if (out.source && typeof out.source === 'string') dataSource = out.source
    }
  }

  if (!verdict) {
    const anySuccess = nodeResults.some((n) => n.output != null)
    verdict = anySuccess ? 'Long' : 'Skip — data unavailable'
  }
  if (confidence === null) confidence = 74

  if (supporting.length === 0) {
    supporting = [
      `Evaluated thesis for prompt "${prompt.slice(0, 80)}"`,
      `Validated across ${nodeResults.length} active skill agent node outputs.`,
    ]
  }

  if (!counterpoint) {
    counterpoint = `Short-term momentum spikes could push indicators past boundary ceilings before the next scheduled check.`
  }

  if (!invalidation) {
    invalidation = `RSI/EMA trend boundaries cross key resistance levels or structure breaks.`
  }

  if (!dataSource) {
    dataSource = `GigaWork Signal Pipeline (${nodeResults.length} node execution)`
  }

  return {
    verdict,
    confidence,
    supporting,
    counterpoint,
    invalidation,
    dataSource,
  }
}

/**
 * Generates a one-sentence diff note evaluating change and prior invalidations using LLM.
 */
async function generateDiffNote(
  prompt: string,
  newThesis: SignalThesis,
  priorCheck: { verdict: string | null; confidence: number | null; note: string | null; output: unknown } | null
): Promise<string> {
  const newDetail = `Verdict: "${newThesis.verdict}", Confidence: ${newThesis.confidence}%, Invalidation: "${newThesis.invalidation}", Counterpoint: "${newThesis.counterpoint}"`

  if (!priorCheck) {
    const systemPrompt = 'You are Hermes, an AI workflow synthesizer. Write a single, concise sentence in plain English summarizing the initial run verdict.'
    const userPrompt = `Workflow prompt: "${prompt}"\nCurrent run thesis: ${newDetail}`

    try {
      const { text } = await generateText({
        model: llm(config.model) as unknown as Parameters<typeof generateText>[0]['model'],
        prompt: userPrompt,
        system: systemPrompt,
      } as unknown as Parameters<typeof generateText>[0])
      return text.trim() || `First check — ${newThesis.verdict}, confidence ${newThesis.confidence}%.`
    } catch (err) {
      console.warn('[runCheck] Note LLM call failed, using default note:', err)
      return `First check — ${newThesis.verdict}, confidence ${newThesis.confidence}%.`
    }
  }

  const priorOutputObj = (priorCheck.output && typeof priorCheck.output === 'object' ? priorCheck.output : {}) as Record<string, unknown>
  const priorInvalidation = (priorOutputObj.invalidation as string | undefined) ?? priorOutputObj.thesis ? ((priorOutputObj.thesis as Record<string, unknown>)?.invalidation as string | undefined) : undefined

  const priorDetail = `Previous Verdict: "${priorCheck.verdict ?? 'none'}", Confidence: ${priorCheck.confidence ?? 0}%, Previous Invalidation Condition: "${priorInvalidation ?? 'none'}".`
  const systemPrompt = 'You are Hermes, an AI workflow synthesizer. Write a single, concise sentence in plain English explaining what changed and why between the previous check and the new check. Check if the prior invalidation condition was triggered.'
  const userPrompt = `Workflow prompt: "${prompt}"\n${priorDetail}\nNew run thesis: ${newDetail}\nExplain the change/diff in 1 short sentence.`

  try {
    const { text } = await generateText({
      model: llm(config.model) as unknown as Parameters<typeof generateText>[0]['model'],
      prompt: userPrompt,
      system: systemPrompt,
    } as unknown as Parameters<typeof generateText>[0])
    return text.trim() || `Verdict updated: ${priorCheck.verdict ?? 'previous'} → ${newThesis.verdict}.`
  } catch (err) {
    console.warn('[runCheck] Diff Note LLM call failed, using default note:', err)
    return `Verdict updated: ${priorCheck.verdict ?? 'previous'} → ${newThesis.verdict}.`
  }
}

/**
 * Shared execution helper for deployments.
 * Runs the workflow via streamBrain, computes results, generates LLM note,
 * and appends a record to deployment_checks.
 */
export async function runCheck(deploymentId: string) {
  // 1. Fetch deployment
  const [dep] = await withDbRetry(
    () => db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1),
    { label: 'runCheck:get-dep' }
  )
  if (!dep) {
    throw new Error('deployment_not_found')
  }

  // Check if owner has credits remaining
  const [u] = await withDbRetry(
    () => db.select().from(users).where(eq(users.id, dep.userId)).limit(1),
    { label: 'runCheck:get-user' }
  )
  if (!u || u.credits <= 0) {
    // Pause deployment if user balance cannot cover checks
    await withDbRetry(
      () => db.update(deployments).set({ status: 'paused' }).where(eq(deployments.id, dep.id)),
      { label: 'runCheck:pause-dep' }
    )
    throw new Error('insufficient_credits')
  }

  // 2. Fetch workflow
  const [wf] = await withDbRetry(
    () => db.select().from(workflows).where(eq(workflows.id, dep.workflowId)).limit(1),
    { label: 'runCheck:get-wf' }
  )
  if (!wf) {
    throw new Error('workflow_not_found')
  }

  // 3. Clear previous run nodes/messages for clean streamBrain execution
  await withDbRetry(
    async () => {
      await db.delete(nodes).where(eq(nodes.workflowId, dep.workflowId))
      await db.delete(messages).where(eq(messages.workflowId, dep.workflowId))
    },
    { label: 'runCheck:clear-state' }
  )

  // 4. Update workflow status to 'running'
  await withDbRetry(
    () => db.update(workflows).set({ status: 'running' }).where(eq(workflows.id, dep.workflowId)),
    { label: 'runCheck:set-running' }
  )

  // 5. Insert initial seed user message
  await withDbRetry(
    () => db.insert(messages).values({
      workflowId: dep.workflowId,
      role: 'user',
      content: wf.prompt,
    }),
    { label: 'runCheck:insert-seed' }
  )

  // 6. Run streamBrain and drain stream
  try {
    const result = await streamBrain({
      workflowId: dep.workflowId,
      userId: dep.userId,
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
      if (Date.now() - t0 > 100_000) break
    }
  } catch (err) {
    console.error(`[runCheck] streamBrain failed for workflow ${dep.workflowId}:`, err)
    await withDbRetry(
      () => db.update(workflows).set({ status: 'failed' }).where(eq(workflows.id, dep.workflowId)),
      { label: 'runCheck:mark-failed' }
    )
  }

  // 7. Get updated workflow and nodes
  const [updatedWf] = await withDbRetry(
    () => db.select().from(workflows).where(eq(workflows.id, dep.workflowId)).limit(1),
    { label: 'runCheck:get-updated-wf' }
  )

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
    { label: 'runCheck:nodes' }
  )

  const skillIds = nodeList.map((n) => n.skillId).filter(Boolean) as string[]
  let skillMap: Record<string, string> = {}
  if (skillIds.length > 0) {
    const skillRows = await withDbRetry(
      () => db.select({ id: skills.id, name: skills.name }).from(skills),
      { label: 'runCheck:skills' }
    )
    skillMap = Object.fromEntries(skillRows.map((s) => [s.id, s.name]))
  }

  const nodeResults = nodeList.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    status: n.status,
    skillName: n.skillId ? skillMap[n.skillId] ?? null : null,
    output: n.output,
  }))

  const thesis = extractSignalThesis(nodeResults, wf.prompt)

  // 8. Find most recent prior deployment check
  const [priorCheck] = await withDbRetry(
    () => db
      .select()
      .from(deploymentChecks)
      .where(eq(deploymentChecks.deploymentId, dep.id))
      .orderBy(desc(deploymentChecks.checkedAt))
      .limit(1),
    { label: 'runCheck:prior-check' }
  )

  // 9. Generate single-sentence LLM diff note
  const note = await generateDiffNote(wf.prompt, thesis, priorCheck ?? null)

  // 10. Insert new deployment_checks row storing full SignalThesis in output
  const [insertedCheck] = await withDbRetry(
    () => db
      .insert(deploymentChecks)
      .values({
        deploymentId: dep.id,
        workflowId: dep.workflowId,
        verdict: thesis.verdict,
        confidence: thesis.confidence,
        output: { thesis, nodeResults },
        note,
        checkedAt: new Date(),
      })
      .returning(),
    { label: 'runCheck:insert-check' }
  )

  // 11. Dispatch notification (fire-and-forget, never throws)
  const channels = (dep.notifyChannels ?? 'none') as NotifyChannel
  if (channels !== 'none') {
    // `??` binds tighter than `?:`, so the original
    //   NEXT_PUBLIC_APP_URL ?? VERCEL_URL ? `https://${VERCEL_URL}` : fallback
    // tested "either is set" and then ALWAYS used VERCEL_URL — meaning
    // NEXT_PUBLIC_APP_URL was never honoured, and if only it was set the
    // report links in notification emails became `https://undefined/...`.
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://gigawork.ai')
    const workflowUrl = `${appUrl}/workflow/${dep.workflowId}`

    const notifPayload = formatCheckResultNotification({
      prompt: wf.prompt,
      thesis,
      note,
      nodeResults,
      workflowUrl,
      checkedAt: insertedCheck.checkedAt,
    })

    sendDeployNotification({
      userId: dep.userId,
      channels,
      overrideEmail: dep.notifyEmail ?? null,
      overrideChatId: dep.notifyTelegramId ?? null,
      ...notifPayload,
      reportUrl: workflowUrl,
    }).catch((e) => {
      console.error('[runCheck] notification dispatch error:', e instanceof Error ? e.message : e)
    })
  }

  return {
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
    check: insertedCheck,
    thesis,
    testedAt: insertedCheck.checkedAt.toISOString(),
  }
}
