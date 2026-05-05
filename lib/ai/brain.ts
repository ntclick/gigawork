import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { eq } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { messages, workflows } from '@/lib/db/schema'
import { listSkills } from '@/lib/skills/registry'
import { HERMES_SYSTEM_PROMPT } from './prompts'
import { buildBrainTools } from './tools'

const kimi = createOpenAICompatible({
  name: 'kimi',
  apiKey: process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY ?? '',
  baseURL: process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1',
})

const MODEL = process.env.KIMI_MODEL ?? 'kimi-k2-0905-preview'

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

  return streamText({
    model: kimi.chatModel(MODEL),
    system: `${HERMES_SYSTEM_PROMPT}\n\n## Available agents (ERC-8004 registry):\n${skillCard}`,
    messages: await convertToModelMessages(opts.uiMessages),
    tools,
    stopWhen: stepCountIs(10),
    temperature: 0.4,
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
