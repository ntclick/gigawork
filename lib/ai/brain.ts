import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { eq } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { messages, workflows } from '@/lib/db/schema'
import { listSkills } from '@/lib/skills/registry'
import { HERMES_SYSTEM_PROMPT } from './prompts'
import { buildBrainTools } from './tools'

// Provider selection — OpenAI gpt-5-mini is the default brain. Set
// AI_PROVIDER=kimi (or =deepseek) in .env.local to swap. Each provider's
// API key + model is kept independently so you can A/B without losing
// config when you switch back.
//
// Defaults:
//   openai   → gpt-5-mini   via https://api.openai.com/v1
//   kimi     → kimi-k2-0905-preview  via https://api.moonshot.ai/v1
//   deepseek → deepseek-chat        via https://api.deepseek.com
const PROVIDER = (process.env.AI_PROVIDER ?? 'kimi').toLowerCase()

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
        model: process.env.OPENAI_MODEL ?? 'gpt-5-mini',
        fallbackModel: process.env.OPENAI_FALLBACK_MODEL ?? 'gpt-4.1',
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
    if (!config.apiKey || !config.fallbackModel) {
      // No fallback configured (kimi/deepseek paths) — just trust env.
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
      if (res.status === 404 || res.status === 403 || res.status === 400) {
        const body = await res.text().catch(() => '')
        if (/model.*not.*found|does.*not.*have.*access|invalid.*model|unsupported/i.test(body)) {
          console.warn(
            `[brain] ${config.model} unavailable (${res.status}) — falling back to ${config.fallbackModel}`,
          )
          RESOLVED_MODEL = config.fallbackModel
          return RESOLVED_MODEL
        }
      }
      // Any other failure (rate limit, 5xx, network) — keep the configured
      // model and let streamText surface the real error to the user.
      RESOLVED_MODEL = config.model
      return RESOLVED_MODEL
    } catch (e) {
      // Network/timeout — don't blame the model. Trust env.
      console.warn('[brain] model probe failed, keeping configured model:', e instanceof Error ? e.message : e)
      RESOLVED_MODEL = config.model
      return RESOLVED_MODEL
    }
  })()
  return probePromise
}

export async function streamBrain(opts: {
  workflowId: string
  userId: string | null
  uiMessages: UIMessage[]
}) {
  const skills = await listSkills()
  const skillCard = skills
    .map((s) => {
      const m = (s.manifest ?? {}) as Record<string, unknown>
      const kw = Array.isArray(m.best_for_keywords) ? (m.best_for_keywords as string[]).join(', ') : ''
      const cat = (m.category as string) ?? 'general'
      const cost = (m.cost_credits as number) ?? 10
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
      return `**${s.name}** · ${cat} · ${cost} credits\n  ${desc}\n  keywords: ${kw}\n  input fields:\n${inputDoc}`
    })
    .join('\n\n')

  const tools = buildBrainTools({ workflowId: opts.workflowId, userId: opts.userId })

  // Resolve model once (probe runs only on first call). Cheap fast-path on
  // subsequent calls — RESOLVED_MODEL is just a string read.
  const activeModel = await probeModel()

  return streamText({
    model: llm.chatModel(activeModel),
    system: `${HERMES_SYSTEM_PROMPT}\n\n## Available agents (ERC-8004 registry):\n${skillCard}`,
    messages: await convertToModelMessages(opts.uiMessages),
    tools,
    maxTokens: 4000,
    stopWhen: stepCountIs(10),
    // temperature: not set — Kimi K2 only supports the default (1).
    onError: async ({ error }) => {
      // Persist mid-stream errors (LLM API rejections, network failures) so
      // they're visible in /api/admin/debug-workflow + the workflow page,
      // not just thrown to the client where the toast truncates them.
      const msg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack?.slice(0, 2000) : undefined
      console.error('[brain.onError]', msg)
      try {
        await db.insert(messages).values({
          workflowId: opts.workflowId,
          role: 'brain',
          content: `❌ Brain stream error: ${msg.slice(0, 1500)}`,
          toolName: 'stream_error',
          toolPayload: { error: msg, stack },
        })
        await db.update(workflows).set({ status: 'failed' }).where(eq(workflows.id, opts.workflowId))
      } catch (dbErr) {
        console.error('[brain.onError] failed to persist', dbErr)
      }
    },
    onFinish: async ({ text, finishReason }) => {
      // Auto-finalize: Kimi sometimes streams the final report as plain text
      // instead of calling finalizeReport. We persist the assembled text
      // and flip the workflow to completed so reload + history pickers work.
      try {
        const cleanText = (text ?? '').trim()
        const alreadyFinalized = await hasFinalizeMessage(opts.workflowId)

        if (cleanText.length > 0 && !alreadyFinalized) {
          await db.insert(messages).values({
            workflowId: opts.workflowId,
            role: 'brain',
            content: cleanText,
            toolName: 'auto_finalize',
            toolPayload: { finishReason, source: 'streamText.onFinish' },
          })
        }

        const status = finishReason === 'stop' || finishReason === 'tool-calls' ? 'completed' : 'failed'
        await db.update(workflows).set({ status }).where(eq(workflows.id, opts.workflowId))
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
