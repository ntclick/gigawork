import { curlFetchJSON } from '../curlFetch'
import { type SkillHandler } from '../handlers'
import { workflowRuntimeConfig } from '../../workflow/runtimeConfig'
import { withTimeout } from '../../workflow/timing'
import { buildDeterministicReport, buildHtmlReport, sanitizeReportMarkdown } from './reportUtils'

export const reportComposerFastHandler: SkillHandler = async (input) => {
  const data = (input.data as Record<string, unknown> | undefined) ?? {}
  const tone = (input.tone as string | undefined) ?? 'casual'
  const format = (input.format as string | undefined) ?? 'markdown'
  const maxSections = Math.min(Number(input.max_sections ?? 6), 12)
  const userNote = typeof input.user_note === 'string' ? input.user_note : undefined
  
  const fallbackMarkdown = sanitizeReportMarkdown(buildDeterministicReport(data, userNote))

  const provider = (process.env.AI_PROVIDER ?? 'deepseek').toLowerCase()
  let apiKey = ''
  let baseUrl = 'https://api.deepseek.com'
  let model = 'deepseek-chat'

  if (provider === 'deepseek') {
    apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
    baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
    model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'
  } else if (provider === 'kimi' || provider === 'moonshot') {
    apiKey = process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY ?? ''
    baseUrl = process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1'
    model = process.env.KIMI_MODEL ?? 'kimi-k2-0905-preview'
  } else {
    apiKey = process.env.OPENAI_API_KEY ?? ''
    baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
    model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
  }

  if (!apiKey || Object.keys(data).length === 0) {
    return {
      format,
      tone,
      composed: false,
      markdown: fallbackMarkdown,
      evidence_markdown: fallbackMarkdown,
      error: !apiKey
        ? `${provider.toUpperCase()}_API_KEY not set — cannot synthesize report. Add it to .env.local.`
        : 'No upstream data passed to composer. Brain should run scanner/sentiment first.',
      raw_input_keys: Object.keys(data),
      generated_at: new Date().toISOString(),
    }
  }

  const systemByTone: Record<string, string> = {
    casual:
      'You are a precise workflow report composer. Return COMPLETE clean markdown only — never cut off in the middle of a section. Always finish every section you start. Use this structure: # Workflow Report, ## Executive Summary, ## Evidence, ## Key Metrics, ## Risks and Gaps, ## Recommended Next Step. Explain jargon in plain English. Use exact numbers from the data. Never invent missing data. If a field is absent, write "data unavailable". No emoji.',
    analytical:
      'You are a quantitative analyst. Synthesize upstream JSON into a COMPLETE, precise markdown brief — never cut off mid-section. Always close every markdown block you open. Use exact numbers from input, flag missing/null/zero fields, separate facts from interpretation. Use h2 sections, compact tables when useful, and a confidence note. Never fabricate.',
    executive:
      'Executive brief format. Write a COMPLETE brief — never cut off. Maximum 8 bullets. For strategy calls, lead with the verdict, calibrated confidence, key supporting evidence, the strongest counterpoint, and the exact invalidation condition. No unsupported claims.',
  }
  const sysPrompt = systemByTone[tone] ?? systemByTone.casual

  // Compact the data JSON — skip null/undefined at top level to save tokens
  const compactData = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v != null)
  )

  const userPrompt = `Upstream agent outputs (JSON):\n\n\`\`\`json\n${JSON.stringify(compactData, null, 2)}\n\`\`\`\n\n` +
    `Compose a COMPLETE ${format} report in ${tone} tone with at most ${maxSections} sections. ` +
    `IMPORTANT: You MUST finish every section — do NOT cut off mid-sentence or mid-section. ` +
    `Ensure every strategy call includes a mandatory counterpoint and invalidation condition. If data is empty/null/zero for a field, say "data unavailable" — never fabricate.`

  const timeoutMs = workflowRuntimeConfig.composerTimeoutMs || 8_000

  try {
    const result = await withTimeout('report-composer-fast', timeoutMs, async () => {
      return await curlFetchJSON<{
        choices: { message: { content: string }; finish_reason?: string }[]
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
          temperature: tone === 'casual' ? 0.3 : 0.2,
          max_tokens: 2500,
        }),
        timeoutMs: timeoutMs - 300,
      })
    })

    let markdown = sanitizeReportMarkdown(result.choices?.[0]?.message?.content?.trim() ?? '')
    const finishReason = result.choices?.[0]?.finish_reason
    if (!markdown) {
      throw new Error(`${provider.toUpperCase()} returned empty content`)
    }
    // If LLM hit token limit mid-generation, append a closing note
    if (finishReason === 'length') {
      markdown += '\n\n---\n_Report reached token limit — upgrade to report-composer for a longer synthesis._'
    }

    const html = buildHtmlReport(data, userNote)
    return {
      format,
      tone,
      composed: true,
      markdown,
      html,
      evidence_markdown: markdown,
      finish_reason: finishReason,
      generated_at: new Date().toISOString(),
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.warn(`[report-composer-fast] synthesis failed or timed out: ${errorMsg}. Returning fallback report.`)
    const html = buildHtmlReport(data, userNote)
    return {
      format,
      tone,
      composed: true,
      markdown: fallbackMarkdown,
      html,
      evidence_markdown: fallbackMarkdown,
      fallback_used: true,
      generated_at: new Date().toISOString(),
    }
  }
}
