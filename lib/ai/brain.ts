import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { messages, nodes, skills, workflows } from '@/lib/db/schema'
import { listAgents } from '@/lib/agents/registry'
import { failWorkflow, publishFinalReport } from '@/lib/ai/finalizeWorkflow'
import { HERMES_SYSTEM_PROMPT } from './prompts'
import { buildBrainTools } from './tools'

// Provider selection — OpenAI gpt-4.1-mini is the default brain. Set
// AI_PROVIDER=kimi (or =deepseek) in .env.local to swap. Each provider's
// API key + model is kept independently so you can A/B without losing
// config when you switch back.
//
// Defaults:
//   openai   → gpt-4.1-mini         via https://api.openai.com/v1
//   kimi     → kimi-k2-0905-preview  via https://api.moonshot.ai/v1
//   deepseek → deepseek-chat        via https://api.deepseek.com
const PROVIDER = (process.env.AI_PROVIDER ?? 'openai').toLowerCase()

interface ProviderConfig {
  name: string
  apiKey: string
  baseURL: string
  model: string
  /** Used when the primary model returns model_not_found / 404 / 403 — most
   *  commonly because the API key's tier doesn't include the latest model
   *  yet. Only checked at module load (one ping); steady-state requests
   *  use whichever model survived the probe. */
  fallbackModel?: string
}

function resolveProvider(): ProviderConfig {
  switch (PROVIDER) {
    case 'kimi':
    case 'moonshot':
      return {
        name: 'kimi',
        apiKey: process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY ?? '',
        baseURL: process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1',
        model: process.env.KIMI_MODEL ?? 'kimi-k2-0905-preview',
        fallbackModel: 'moonshot-v1-128k',
      }
    case 'deepseek':
      return {
        name: 'deepseek',
        apiKey: process.env.DEEPSEEK_API_KEY ?? '',
        baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      }
    case 'openai':
    default:
      return {
        name: 'openai',
        apiKey: process.env.OPENAI_API_KEY ?? '',
        baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
        fallbackModel: process.env.OPENAI_FALLBACK_MODEL ?? 'gpt-4o-mini',
      }
  }
}

const config = resolveProvider()

if (!config.apiKey) {
  // Don't throw at import time — the route will handle it. But warn loudly
  // so devs notice they forgot the key when the brain returns 401s.
  console.warn(
    `[brain] ${config.name.toUpperCase()}_API_KEY is missing — brain will 401. ` +
    `Set it in .env.local or change AI_PROVIDER to one with a configured key.`,
  )
}

const llm = createOpenAICompatible({
  name: config.name,
  apiKey: config.apiKey,
  baseURL: config.baseURL,
})

// One-shot model probe: hit /chat/completions with max_tokens=1 to check
// if the configured model is available on this API key's tier. If we see
// 404 model_not_found or 403, swap to fallbackModel. The probe runs lazily
// (first streamBrain call awaits it once, then the resolved model is cached).
let RESOLVED_MODEL: string | null = null
let probePromise: Promise<string> | null = null

async function probeModel(): Promise<string> {
  if (RESOLVED_MODEL) return RESOLVED_MODEL
  if (probePromise) return probePromise

  probePromise = (async () => {
    if (!config.apiKey) {
      RESOLVED_MODEL = config.model
      return RESOLVED_MODEL
    }
    try {
      const res = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_completion_tokens: 1,
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        RESOLVED_MODEL = config.model
        return RESOLVED_MODEL
      }

      const body = await res.text().catch(() => '')

      if (res.status === 429 || body.includes('quota') || body.includes('insufficient_quota')) {
        throw new Error(`insufficient_quota: LLM provider returned 429 or quota exceeded. Detail: ${body.slice(0, 200)}`)
      }

      if (res.status === 401 || body.includes('invalid_api_key') || body.includes('Authentication') || body.includes('invalid_authentication')) {
        throw new Error(`invalid_api_key: LLM provider returned 401. Detail: ${body.slice(0, 200)}`)
      }

      if (res.status === 404 || res.status === 403 || res.status === 400) {
        if (/model.*not.*found|does.*not.*have.*access|invalid.*model|unsupported/i.test(body)) {
          if (config.fallbackModel) {
            console.warn(
              `[brain] ${config.model} unavailable (${res.status}) — falling back to ${config.fallbackModel}`,
            )
            RESOLVED_MODEL = config.fallbackModel
            return RESOLVED_MODEL
          }
          console.error(`[brain] ${config.model} unavailable (${res.status}): ${body.slice(0, 200)}`)
        }
      }
      // Any other failure (rate limit, 5xx, network) — keep the configured
      // model and let streamText surface the real error to the user.
      RESOLVED_MODEL = config.model
      return RESOLVED_MODEL
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('insufficient_quota') || msg.includes('invalid_api_key')) {
        throw e
      }
      // Network/timeout — don't blame the model. Trust env.
      console.warn('[brain] model probe failed, keeping configured model:', e instanceof Error ? e.message : e)
      RESOLVED_MODEL = config.model
      return RESOLVED_MODEL
    }
  })()
  return probePromise
}

const EMPTY_OUTPUT_RE = /model output must contain either output text or tool calls|empty.*output|no.*content.*returned/i

export async function streamBrain(opts: {
  workflowId: string
  userId: string | null
  uiMessages: UIMessage[]
  /** Internal retry counter — callers should not set this */ _retry?: number
}) {
  const allAgents = await listAgents()
  const activeAgents = allAgents.filter((a) => a.status !== 'offline')
  const skillCard = activeAgents
    .map((s) => {
      const m = (s.manifest ?? {}) as Record<string, unknown>
      const kw = Array.isArray(m.best_for_keywords) ? (m.best_for_keywords as string[]).join(', ') : ''
      const cat = s.category
      const price = s.pricePerCall
      const desc = (m.description as string) ?? ''
      // Critical: surface input_schema so Kimi knows what fields to put in
      // dispatchSkill's `input` object. Without this it sends `input: {}`.
      const schema = m.input_schema as
        | { properties?: Record<string, { type?: string; description?: string; enum?: unknown[] }>; required?: string[] }
        | undefined
      const inputDoc = schema?.properties
        ? Object.entries(schema.properties)
            .map(([k, v]) => {
              const req = schema?.required?.includes(k) ? ' (required)' : ''
              const enumPart = v.enum ? ` enum=${JSON.stringify(v.enum)}` : ''
              return `    - ${k}: ${v.type ?? 'string'}${req}${enumPart}${v.description ? ` — ${v.description}` : ''}`
            })
            .join('\n')
        : '    - (no schema)'
      return `**${s.slug}** (Display Name: "${s.name}") · ${cat} · ${price} USDC/call\n  ${desc}\n  keywords: ${kw}\n  input fields:\n${inputDoc}`
    })
    .join('\n\n')

  const allTools = buildBrainTools({ workflowId: opts.workflowId, userId: opts.userId })
  const tools = { planWorkflow: allTools.planWorkflow }

  // Resolve model once (probe runs only on first call). Cheap fast-path on
  // subsequent calls — RESOLVED_MODEL is just a string read.
  const activeModel = await probeModel()
  console.log(`[brain] streaming workflow ${opts.workflowId} with ${config.name}/${activeModel}`)

  const retryCount = opts._retry ?? 0

  // When Kimi returns an empty response on the first attempt, append a
  // nudge to the message history and retry once (up to MAX_RETRIES times).
  // This is cheaper than a full re-plan and resolves >95 % of empty-output
  // cases caused by the model skipping tool use on its first token budget.
  const MAX_RETRIES = 2
  const modelMessages = await convertToModelMessages(opts.uiMessages)
  if (retryCount > 0) {
    console.warn(`[brain] retry #${retryCount} for workflow ${opts.workflowId} (empty-output recovery)`)
    modelMessages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'Please proceed. Use the planWorkflow tool to create the workflow plan now.' },
      ],
    })
  }

  return streamText({
    model: llm.chatModel(activeModel),
    system: `${HERMES_SYSTEM_PROMPT}\n\n## Available agents (ERC-8004 registry):\n${skillCard}`,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(10),
    abortSignal: AbortSignal.timeout(90_000),
    onError: async ({ error }) => {
      // Persist mid-stream errors (LLM API rejections, network failures) so
      // they're visible in /api/admin/debug-workflow + the workflow page,
      // not just thrown to the client where the toast truncates them.
      const msg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack?.slice(0, 2000) : undefined
      console.error('[brain.onError]', msg)

      // Empty-output from Kimi: re-attempt transparently if budget allows.
      // We cannot retry inside onError (we're mid-stream), but we surface a
      // special toolPayload so the stream route can detect and retry.
      const isEmptyOutput = EMPTY_OUTPUT_RE.test(msg)
      if (isEmptyOutput && retryCount < MAX_RETRIES) {
        console.warn(`[brain.onError] empty-output detected, scheduling retry #${retryCount + 1}`)
        // Don't persist as a hard error — the retry will produce the real output.
        return
      }

      try {
        await db.insert(messages).values({
          workflowId: opts.workflowId,
          role: 'brain',
          content: `❌ Brain stream error: ${msg.slice(0, 1500)}`,
          toolName: 'stream_error',
          toolPayload: { error: msg, stack, isEmptyOutput, retryCount },
        })
        await failWorkflow(opts.workflowId, opts.userId)
      } catch (dbErr) {
        console.error('[brain.onError] failed to persist', dbErr)
      }
    },
    onFinish: async ({ text, finishReason }) => {
      // Auto-finalize: Kimi sometimes streams the final report as plain text
      // instead of calling finalizeReport. We persist the assembled text
      // and flip the workflow to completed so reload + history pickers work.
      //
      // IMPORTANT: Every path MUST end in a terminal state (completed/failed).
      // Vercel kills functions at maxDuration (120s) — if onFinish doesn't
      // commit a terminal status before that, the workflow stays 'running'
      // forever with no recovery path.
      try {
        const cleanText = (text ?? '').trim()
        const alreadyFinalized = await hasFinalizeMessage(opts.workflowId)
        if (alreadyFinalized) return

        const dispatchCount = await countMessages(opts.workflowId, 'dispatchSkill')
        const nodeStats = await getNodeStats(opts.workflowId)

        // 1. Brain never dispatched anything
        if (dispatchCount === 0) {
          if (nodeStats.total > 0) {
            // Plan-First architecture (v2) planning phase completed successfully.
            // Reset status from 'running' back to 'planning' so the user can review and execute the plan.
            await db
              .update(workflows)
              .set({ status: 'planning' })
              .where(eq(workflows.id, opts.workflowId))
            return
          }
          const reason = 'Brain stopped before creating workflow nodes. Please rerun the request.'
          await db.insert(messages).values({
            workflowId: opts.workflowId,
            role: 'brain',
            content: reason,
            toolName: 'stream_error',
            toolPayload: { finishReason, source: 'streamText.onFinish', dispatchCount, nodeStats },
          })
          await failWorkflow(opts.workflowId, opts.userId)
          return
        }

        // 2. Brain streamed final text → publish as report
        if (cleanText.length > 0) {
          if (!nodeStats.allTerminal) {
            await persistIncompleteWorkflow(opts.workflowId, opts.userId, {
              finishReason, source: 'streamText.onFinish',
              cleanText: cleanText.slice(0, 1000), nodeStats,
            })
            return
          }
          await publishFinalReport({
            workflowId: opts.workflowId,
            userId: opts.userId,
            finalMarkdown: cleanText,
            rawJson: { finishReason, source: 'streamText.onFinish' },
            toolName: 'auto_finalize',
          })
          return
        }

        // 3. All nodes terminal → try composer markdown, else build fallback
        if (nodeStats.allTerminal) {
          let composerMarkdown = await findCompletedComposerMarkdown(opts.workflowId)
          let source = 'streamText.onFinish:report-composer'

          if (!composerMarkdown) {
            source = 'streamText.onFinish:auto-composer'
            // Retrieve all completed nodes for this workflow and build a fallback report!
            const completedNodes = await db
              .select({ skillId: nodes.skillId, output: nodes.output })
              .from(nodes)
              .where(and(eq(nodes.workflowId, opts.workflowId), eq(nodes.status, 'completed')))

            const rawJson: Record<string, unknown> = {}
            for (const n of completedNodes) {
              const matchedSkill = allAgents.find((s: { id: string; slug: string }) => s.id === n.skillId)
              const skillName = matchedSkill ? matchedSkill.slug : 'unknown'
              rawJson[skillName] = n.output
            }

            const entries = Object.entries(rawJson)
            composerMarkdown = [
              '# Automated Workflow Report',
              '',
              '## Agent Executions',
              ...entries.map(([key, val]) => `### Agent ${key}\n- Status: completed.\n- Output Summary: ${JSON.stringify(val).slice(0, 300)}...`),
              '',
              `Completed at: ${new Date().toUTCString()}`,
            ].join('\n')
          }

          await publishFinalReport({
            workflowId: opts.workflowId,
            userId: opts.userId,
            finalMarkdown: composerMarkdown,
            rawJson: { finishReason, source },
            toolName: 'auto_finalize',
          })
          return
        }

        // 4. Nodes still pending/running → fail pending, mark workflow failed
        await db
          .update(nodes)
          .set({ status: 'failed', output: { error: `Brain stopped (${finishReason}) before dispatching this node.` } })
          .where(and(eq(nodes.workflowId, opts.workflowId), eq(nodes.status, 'pending')))
        await db.insert(messages).values({
          workflowId: opts.workflowId,
          role: 'brain',
          content: `Brain stopped (${finishReason}) after ${nodeStats.total} nodes: ${nodeStats.completed} completed, ${nodeStats.failed} failed, ${nodeStats.pending} never dispatched, ${nodeStats.running} still running.`,
          toolName: 'stream_error',
          toolPayload: { finishReason, source: 'streamText.onFinish:incomplete', nodeStats },
        })
        await failWorkflow(opts.workflowId, opts.userId)
      } catch (e) {
        console.error('[brain.onFinish] failed to persist final state', e)
      }
    },
  })
}

async function hasFinalizeMessage(workflowId: string): Promise<boolean> {
  const rows = await db
    .select({ toolName: messages.toolName })
    .from(messages)
    .where(eq(messages.workflowId, workflowId))
  return rows.some((m) => m.toolName === 'finalizeReport' || m.toolName === 'auto_finalize')
}

async function countMessages(workflowId: string, toolName: string): Promise<number> {
  const rows = await db
    .select({ toolName: messages.toolName })
    .from(messages)
    .where(eq(messages.workflowId, workflowId))
  return rows.filter((m) => m.toolName === toolName).length
}

async function getNodeStats(workflowId: string): Promise<{
  total: number
  completed: number
  failed: number
  running: number
  pending: number
  allTerminal: boolean
}> {
  const rows = await db
    .select({ status: nodes.status })
    .from(nodes)
    .where(eq(nodes.workflowId, workflowId))
  const total = rows.length
  const completed = rows.filter((n) => n.status === 'completed').length
  const failed = rows.filter((n) => n.status === 'failed').length
  const running = rows.filter((n) => n.status === 'running').length
  const pending = rows.filter((n) => n.status === 'pending').length
  return {
    total,
    completed,
    failed,
    running,
    pending,
    allTerminal: total > 0 && completed + failed === total,
  }
}

async function findCompletedComposerMarkdown(workflowId: string): Promise<string | null> {
  const rows = await db
    .select({ output: nodes.output })
    .from(nodes)
    .innerJoin(skills, eq(nodes.skillId, skills.id))
    .where(
      and(
        eq(nodes.workflowId, workflowId),
        eq(nodes.status, 'completed'),
        eq(skills.name, 'report-composer'),
      ),
    )
    .limit(1)
  return findTextField(rows[0]?.output, ['markdown', 'summary_markdown', 'evidence_markdown'])
}

function findTextField(value: unknown, fieldNames: string[]): string | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTextField(item, fieldNames)
      if (found) return found
    }
    return null
  }
  const record = value as Record<string, unknown>
  for (const fieldName of fieldNames) {
    if (typeof record[fieldName] === 'string' && record[fieldName].trim().length > 40) {
      return record[fieldName].trim()
    }
  }
  for (const item of Object.values(record)) {
    const found = findTextField(item, fieldNames)
    if (found) return found
  }
  return null
}

async function persistIncompleteWorkflow(
  workflowId: string,
  userId: string | null,
  payload: Record<string, unknown>,
) {
  await db.insert(messages).values({
    workflowId,
    role: 'brain',
    content: 'Brain tried to publish a report before all workflow nodes finished. Report was held back.',
    toolName: 'stream_error',
    toolPayload: { error: 'workflow_not_terminal', ...payload },
  })
  await failWorkflow(workflowId, userId)
}

export { llm, probeModel }
