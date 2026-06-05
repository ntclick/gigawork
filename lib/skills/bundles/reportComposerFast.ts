import { curlFetchJSON } from '../curlFetch'
import { type SkillHandler } from '../handlers'
import { workflowRuntimeConfig } from '../../workflow/runtimeConfig'
import { withTimeout } from '../../workflow/timing'
import { buildDeterministicReport, sanitizeReportMarkdown } from './reportUtils'

export const reportComposerFastHandler: SkillHandler = async (input) => {
  const data = (input.data as Record<string, unknown> | undefined) ?? {}
  const tone = (input.tone as string | undefined) ?? 'casual'
  const format = (input.format as string | undefined) ?? 'markdown'
  const maxSections = Math.min(Number(input.max_sections ?? 6), 12)
  const userNote = typeof input.user_note === 'string' ? input.user_note : undefined
  
  const fallbackMarkdown = sanitizeReportMarkdown(buildDeterministicReport(data, userNote))

  const provider = (process.env.AI_PROVIDER ?? 'openai').toLowerCase()
  const useOpenAI = provider === 'openai' || !process.env.KIMI_API_KEY

  const apiKey = useOpenAI ? (process.env.OPENAI_API_KEY ?? '') : (process.env.KIMI_API_KEY ?? '')
  const baseUrl = useOpenAI
    ? (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1')
    : (process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1')
  const model = useOpenAI
    ? (process.env.OPENAI_MODEL ?? 'gpt-4o-mini')
    : (process.env.KIMI_MODEL ?? 'kimi-k2-0905-preview')

  if (!apiKey || Object.keys(data).length === 0) {
    return {
      format,
      tone,
      composed: false,
      markdown: fallbackMarkdown,
      evidence_markdown: fallbackMarkdown,
      error: !apiKey
        ? `${useOpenAI ? 'OPENAI_API_KEY' : 'KIMI_API_KEY'} not set — cannot synthesize report. Add it to .env.local.`
        : 'No upstream data passed to composer. Brain should run scanner/sentiment first.',
      raw_input_keys: Object.keys(data),
      generated_at: new Date().toISOString(),
    }
  }

  const systemByTone: Record<string, string> = {
    casual:
      'You are a precise workflow report composer for beginners. Return clean markdown only. Use this structure: # Workflow Report, ## Executive Summary, ## Evidence, ## Risks and Gaps, ## Recommended Next Step, ## Sources. Explain jargon in plain English. Use exact numbers from input. Never invent missing data. If a field is absent, write "data unavailable". No emoji.',
    analytical:
      'You are a quantitative analyst. Synthesize upstream JSON into a precise markdown brief. Use exact numbers from input, flag missing/null/zero fields, and separate facts from interpretation. Use h2 sections, compact tables when useful, and a confidence note. Never fabricate.',
    executive:
      'Executive brief format. Maximum 7 bullets. Lead with the verdict, include evidence quality, risks, and one action. No unsupported claims.',
  }
  const sysPrompt = systemByTone[tone] ?? systemByTone.casual

  const userPrompt = `Upstream agent outputs (JSON):\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n\n` +
    `Compose a ${format} brief in ${tone} tone with at most ${maxSections} sections. ` +
    `If data is empty/null/zero for a field, say "data unavailable" — never fabricate.`

  const timeoutMs = workflowRuntimeConfig.composerTimeoutMs || 8_000

  try {
    const result = await withTimeout('report-composer-fast', timeoutMs, async () => {
      return await curlFetchJSON<{
        choices: { message: { content: string } }[]
      }>(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: tone === 'casual' ? 0.4 : 0.2,
          max_tokens: 800,
        }),
        timeoutMs: timeoutMs - 500, // leave a tiny buffer for connection logic
      })
    })

    const markdown = sanitizeReportMarkdown(result.choices?.[0]?.message?.content?.trim() ?? '')
    if (!markdown) {
      throw new Error(`${useOpenAI ? 'OpenAI' : 'Kimi'} returned empty content`)
    }

    return {
      format,
      tone,
      composed: true,
      markdown,
      evidence_markdown: markdown,
      generated_at: new Date().toISOString(),
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.warn(`[report-composer-fast] synthesis failed or timed out: ${errorMsg}. Returning fallback report.`)
    return {
      format,
      tone,
      composed: false,
      markdown: fallbackMarkdown,
      evidence_markdown: fallbackMarkdown,
      error: `Synthesis failed or timed out: ${errorMsg}`,
      generated_at: new Date().toISOString(),
    }
  }
}
