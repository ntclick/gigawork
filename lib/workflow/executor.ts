import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { messages, nodes, skills, users, nanopaymentEvents } from '@/lib/db/schema'
import { callSkillEndpoint } from '@/lib/skills/registry'
import { chargeUsdcBalance, depositUsdcBalance, InsufficientUsdcError } from '@/lib/payments/depositVault'
import { settleSkillPaymentOnChain, NanopaymentSettlementError } from '@/lib/payments/nanopaymentSettlement'
import { decryptProfileSecrets } from '@/lib/notifications/secrets'
import { failWorkflow, publishFinalReport } from '@/lib/ai/finalizeWorkflow'
import { emitWorkflowEvent } from '@/lib/workflow/events'
import { withTimeout } from '@/lib/workflow/timing'
import { workflowRuntimeConfig } from '@/lib/workflow/runtimeConfig'

/**
 * Thrown when the vault cannot settle an agent's fee, to abort the whole
 * run rather than let the remaining agents work unpaid. Distinct from a
 * skill failure: the agent did its job, we just could not pay for it.
 */
export class WorkflowPaymentHaltedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowPaymentHaltedError'
  }
}

export async function executeWorkflowRun({ workflowId, userId }: { workflowId: string; userId: string | null }) {
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
  // Set by any node whose fee the vault could not settle. See
  // WorkflowPaymentHaltedError.
  const halt: { reason: string | null } = { reason: null }

  while (true) {
    const currentNodes = await db.select().from(nodes).where(eq(nodes.workflowId, workflowId))

    const allFinished = currentNodes.every((n) => n.status === 'completed' || n.status === 'failed')
    if (allFinished) {
      break
    }

    // Stop dispatching once the vault has failed to pay. Nodes already in
    // flight are left to finish — they are mid-request and stopping them
    // would waste work that is about to arrive — but nothing new starts.
    if (halt.reason) {
      if (activeExecutions.size > 0) {
        await Promise.race(activeExecutions.values())
        continue
      }
      for (const pn of currentNodes.filter((n) => n.status === 'pending')) {
        await db
          .update(nodes)
          .set({ status: 'failed', output: { error: 'Skipped: run halted, vault could not pay' } })
          .where(eq(nodes.id, pn.id))
      }
      break
    }

    // Fast-fail any pending node whose dependency has already failed
    for (const n of currentNodes) {
      if (n.status !== 'pending' || activeExecutions.has(n.id)) continue
      const deps = n.dependsOn || []
      const hasFailedDep = deps.some((depSlug) => {
        const depUuid = planToNodeId.get(depSlug)
        if (!depUuid) return false
        const depNode = currentNodes.find((x) => x.id === depUuid)
        return depNode && depNode.status === 'failed'
      })
      if (hasFailedDep) {
        await db
          .update(nodes)
          .set({ status: 'failed', output: { error: 'Skipped: dependency failed' } })
          .where(eq(nodes.id, n.id))
      }
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
        userId: userId ?? 'system-guest',
        halt,
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

  // A halted run does not get a report. Publishing one would settle the
  // escrow and tell the user the job was done, when in fact the agents
  // that did run were never paid and the rest never started.
  if (halt.reason) {
    await emitWorkflowEvent({
      workflowId,
      type: 'workflow.payment_halted',
      status: 'failed',
      message: halt.reason,
    }).catch(() => {})
    await failWorkflow(workflowId, userId ?? 'system-guest')
    console.log(`[executor:${workflowId}] Halted: ${halt.reason}`)
    return
  }

  if (composerCompleted && composerCompleted.output) {
    const out = composerCompleted.output as { markdown?: string; summary_markdown?: string; evidence_markdown?: string } | null
    const markdown = out?.markdown || out?.summary_markdown || out?.evidence_markdown || ''
    if (markdown) {
      await publishFinalReport({
        workflowId,
        userId: userId ?? 'system-guest',
        finalMarkdown: markdown,
        rawJson: { nodes: finalNodes.map((n) => ({ id: n.id, skill: skillMap.get(n.skillId ?? ''), status: n.status })) },
        toolName: 'auto_finalize',
      })
      console.log(`[executor:${workflowId}] Workflow completed successfully. Report published.`)
      return
    }
  }

  if (hasFailures) {
    await failWorkflow(workflowId, userId ?? 'system-guest')
    console.log(`[executor:${workflowId}] Workflow failed due to node failures.`)
  } else {
    // All succeeded but report-composer/report-composer-fast did not run or produce output. Build rich fallback report.
    const rawJson: Record<string, unknown> = {}
    for (const n of finalNodes) {
      const skillName = skillMap.get(n.skillId ?? '') || 'unknown'
      rawJson[skillName] = n.output
    }
    const { buildDeterministicReport } = await import('@/lib/skills/bundles/reportUtils')
    const fallbackMarkdown = buildDeterministicReport(rawJson)
    await publishFinalReport({
      workflowId,
      userId: userId ?? 'system-guest',
      finalMarkdown: fallbackMarkdown,
      rawJson,
      toolName: 'auto_finalize',
    })
    console.log(`[executor:${workflowId}] Workflow finished. Rich report published.`)
  }
}

async function executeSingleNodeParallel(opts: {
  nodeId: string
  planToNodeId: Map<string, string>
  workflowId: string
  userId: string
  /** Shared across the run: set when payment fails so the DAG stops. */
  halt: { reason: string | null }
}) {
  const { nodeId, planToNodeId, workflowId, userId, halt } = opts

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

  // ── Deploy-only guard ────────────────────────────────────────────────────────
  // telegram-sender and email-sender are notification agents that should only
  // run when explicitly triggered via the Deploy flow (cron/webhook).
  // If they appear in the DAG during normal execution, skip them gracefully
  // so they don't pollute the report or count as failures.
  const NOTIFICATION_SKILLS = new Set(['email-sender', 'telegram-sender'])
  if (NOTIFICATION_SKILLS.has(skill.name)) {
    const completedAt = new Date()
    await db
      .update(nodes)
      .set({
        status: 'completed',
        completedAt,
        timing: { durationMs: completedAt.getTime() - startedAt.getTime() },
        output: {
          ok: false,
          warning: `${skill.name} is only active in Deploy mode. Configure it via Settings → Alerts.`,
          skipped: true,
        },
      })
      .where(eq(nodes.id, nodeId))
    console.log(`[executor:${workflowId}] Skipped notification agent "${skill.name}" (deploy-only).`)
    return
  }
  // ── End deploy-only guard ────────────────────────────────────────────────────


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

  // 3. Affordability gate.
  //
  // Payment itself is deferred until AFTER the agent produces a result —
  // see settleNodePayment() below. Previously the vault was debited and
  // an on-chain x402 transfer was sent BEFORE the skill ran, so a skill
  // that timed out or errored still cost the user real money and there
  // was no refund path (only a failed *settlement* was refunded, not a
  // failed *skill*). Now we only check the balance up front, so a broke
  // user still can't start expensive work, but nobody pays for a result
  // they never got.
  const manifest = (skill.manifest ?? {}) as Record<string, unknown>
  const costCredits = Math.max(0, Math.round((manifest.cost_credits as number) ?? 5))
  const costUsdcVal = costCredits > 0 ? costCredits / 100 : 0.08
  const costUsdc = ((costCredits || 8) / 100).toFixed(2)
  const billable = !!userId && userId !== 'system-guest' && costUsdcVal > 0

  let buyerAddress = '0x0000...0000'
  if (userId && userId !== 'system-guest') {
    const [u] = await db
      .select({ wallet: users.wallet, usdcBalance: users.usdcBalance })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (u?.wallet) buyerAddress = u.wallet

    if (billable) {
      const have = parseFloat(u?.usdcBalance ?? '0')
      if (!Number.isFinite(have) || have < costUsdcVal) {
        const completedAt = new Date()
        await db
          .update(nodes)
          .set({
            status: 'failed',
            completedAt,
            timing: { durationMs: completedAt.getTime() - startedAt.getTime() },
            output: { error: 'insufficient_usdc', need: costUsdcVal, have },
          })
          .where(eq(nodes.id, nodeId))

        await db.insert(messages).values({
          workflowId,
          role: 'brain',
          nodeId,
          content:
            `❌ **System:** Insufficient USDC vault balance to run Agent **${skill.name}**. ` +
            `Requires $${costUsdcVal.toFixed(2)} USDC, currently have $${have.toFixed(2)} USDC.`,
        })
        return
      }
    }
  }

  /**
   * Charge for a node that actually delivered: debit the off-chain
   * ledger, then settle the same amount on-chain from the user's vault
   * (x402). If the on-chain leg fails the ledger debit is rolled back so
   * the two never disagree.
   *
   * Called only on the success path. A failed or timed-out agent is free.
   */
  const settleNodePayment = async (): Promise<void> => {
    if (!billable || !userId) return
    try {
      await chargeUsdcBalance({
        userId,
        amountUsdc: costUsdcVal,
        reason: `dispatch:${skill.name}`,
        workflowId,
      })
    } catch (err) {
      // Raced another node down to zero between the gate and here.
      const have = err instanceof InsufficientUsdcError ? err.have : 0
      console.warn(`[executor] skipping charge for ${skill.name}: balance ${have} < ${costUsdcVal}`)
      return
    }

    try {
      const { txHash } = await settleSkillPaymentOnChain({ userId, amountUsdc: costUsdcVal })
      await db
        .insert(nanopaymentEvents)
        .values({
          workflowId,
          stepId: nodeId,
          skillName: skill.name,
          amountUsdc: costUsdc,
          buyerAddress,
          status: 'settled',
          txHash,
        })
        .catch((e) => console.error('[executor] failed to insert nanopayment event:', e))
    } catch (err) {
      const msg = err instanceof NanopaymentSettlementError ? err.message : String(err)
      await depositUsdcBalance({
        userId,
        amountUsdc: costUsdcVal,
        reason: `refund:settlement_failed:${skill.name}`,
      }).catch((refundErr) =>
        console.error('[executor] refund after failed settlement also failed:', refundErr),
      )
      await db
        .insert(nanopaymentEvents)
        .values({
          workflowId,
          stepId: nodeId,
          skillName: skill.name,
          amountUsdc: costUsdc,
          buyerAddress,
          status: 'failed',
        })
        .catch((e) => console.error('[executor] failed to insert failed nanopayment event:', e))
      console.error(`[executor] on-chain settlement failed for ${skill.name}: ${msg}`)

      // A vault that cannot pay this agent will not pay the next one
      // either. Carrying on produced a run where every line read
      // "failed $0.01 → …", every agent worked for nothing, and a report
      // was published as if the run had been paid for. Stop, and say why.
      if (/insufficient|exceeds balance|funds/i.test(msg)) {
        throw new WorkflowPaymentHaltedError(
          `Your vault could not pay ${skill.name} ($${costUsdc}). The run was stopped so the remaining agents are not asked to work unpaid. Top up your vault and run it again.`,
        )
      }
    }
  }

  // 4. Inject profile credentials
  const inputParams = { ...((node.input as Record<string, unknown> | null) ?? {}) }

  if (userId && (skill.name === 'email-sender' || skill.name === 'telegram-sender')) {
    const [profileRow] = await db
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
    // Secrets are encrypted at rest — see lib/notifications/secrets.ts.
    const profile = decryptProfileSecrets(profileRow)

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

  // 5b. Senders get the report their upstream composer produced.
  //
  // Nothing was supplying it. The planner can't — at plan time the report
  // does not exist yet — and the executor only injected credentials here,
  // not content. telegram-sender has a DB fallback that reads the composed
  // report, but it is gated on `input.workflowId`, and callSkillEndpoint
  // passes workflowId in its OPTIONS argument, never merging it into the
  // input the local handler actually receives — so that fallback could
  // never fire. email-sender has no fallback at all.
  //
  // Net effect on the two shipped templates: "Daily Digest → Telegram"
  // sent the handler's generic "no customized message body was composed"
  // placeholder, and "Yield Report → Email" mailed an empty body. Both
  // reported success.
  //
  // Taking it from parentOutputs (rather than re-querying) keeps this on
  // the same data the DAG already resolved, and only fills a field the
  // user or planner left empty.
  if (skill.name === 'email-sender' || skill.name === 'telegram-sender') {
    const composed = Object.values(parentOutputs).find((o) => {
      const md = (o as Record<string, unknown> | null)?.markdown
      return typeof md === 'string' && md.trim().length > 0
    }) as { markdown?: string } | undefined

    // "Empty" has to include the planner's invented placeholders. Asked for
    // a sender body it cannot know yet, the model writes things like
    // `{{report_composer.output}}` — a real string, so a plain `!value`
    // guard treats it as user-supplied and leaves it alone, and that
    // literal text is what gets delivered. (Verified: a Daily Digest run
    // planned `message: "{{report_composer.output}}"`.) report-composer's
    // `data` avoids this by overwriting unconditionally; senders can't
    // quite do that, since a genuinely custom message is legitimate — so
    // treat a lone {{…}} placeholder as the absence of one.
    const isPlaceholder = (v: unknown) =>
      typeof v === 'string' && /^\s*\{\{[^}]*\}\}\s*$/.test(v)
    const needsBody = (v: unknown) => !v || isPlaceholder(v)

    if (composed?.markdown) {
      if (skill.name === 'telegram-sender' && needsBody(inputParams.message)) {
        inputParams.message = composed.markdown
      }
      if (skill.name === 'email-sender' && needsBody(inputParams.body_markdown)) {
        inputParams.body_markdown = composed.markdown
      }
    }
    // The handler's own DB fallback is a second line of defence; give it
    // the id it needs so it can actually run when parentOutputs is empty
    // (e.g. a sender wired to depend on something other than the composer).
    if (!inputParams.workflowId) inputParams.workflowId = workflowId
  }

  // Determine Timeout Limit.
  // `report-composer` needs the composer budget just as much as
  // `report-composer-fast` does — it makes a real LLM synthesis call that
  // routinely takes ~10s and its own internal HTTP timeout is 30s. Only
  // the -fast variant was listed here, so the plain composer was killed
  // by the 15s node timeout every single time and every run fell back to
  // the deterministic template while still being charged.
  let timeoutLimit = workflowRuntimeConfig.nodeTimeoutMs || 8_000
  if (skill.name === 'market-data-bundle' || skill.name === 'social-lite-bundle') {
    timeoutLimit = workflowRuntimeConfig.bundleTimeoutMs || 12_000
  } else if (skill.name === 'report-composer' || skill.name === 'report-composer-fast') {
    timeoutLimit = workflowRuntimeConfig.composerTimeoutMs || 45_000
  }

  // 6. Execute the skill call
  try {
    const output = await withTimeout(skill.name, timeoutLimit, async () => {
      return (await callSkillEndpoint(skill, inputParams, { workflowId, nodeId, timeoutMs: timeoutLimit })) as Record<string, unknown>
    })

    const completedAt = new Date()

    // The agent delivered — now, and only now, take payment.
    await settleNodePayment()

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

    // A payment halt is not this agent's fault and must not be absorbed as
    // just one more failed node — it stops the whole run.
    if (err instanceof WorkflowPaymentHaltedError) halt.reason = err.message

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
