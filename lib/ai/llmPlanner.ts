/**
 * llmPlanner — turn a user's objective into a real execution plan.
 *
 * What this replaces: planning used to be `selectMockPlan` in
 * lib/ai/simulation.ts, which was not a planner at all. It matched
 * keywords against six hardcoded graphs — `prompt.includes('pepe') →
 * token-scanner template` — with the skill inputs baked in. That is why
 * asking for SOL/USDT produced a run against USDT/USDT: the template's
 * parameters never looked at the prompt. It also announced itself as
 * "Offline Simulation Mode — LLM API key quota exceeded", a reason it
 * invented, having never called an LLM. Those templates survive only as
 * the fallback below.
 *
 * This asks the configured model (DeepSeek v4 flash by default) to pick
 * agents and their arguments from the live skill registry, then validates
 * the answer before anything is written:
 *
 *   - every skill_name must exist in the registry
 *   - every depends_on must reference a node declared in the same plan
 *   - a report-composer must be present; only a sender may follow it
 *   - notification senders are refused unless the objective asked for one
 *
 * A model is allowed to be wrong; it is not allowed to be wrong silently.
 * Anything that fails validation falls back to the keyword templates and
 * SAYS it fell back, with the real reason attached.
 */
import { curlFetchJSON } from '@/lib/skills/curlFetch'
import type { Skill } from '@/lib/db/schema'

export interface PlannedNode {
  id: string
  label: string
  skill_name: string
  depends_on: string[]
  input?: Record<string, unknown>
}

export interface PlanResult {
  title: string
  nodes: PlannedNode[]
  source: 'llm' | 'fallback'
  model?: string
  /** Populated when `source` is 'fallback' — why the model was not used. */
  fallbackReason?: string
}

/** Senders cost the user an outbound message; only plan one on request. */
const SENDER_SKILLS = new Set(['email-sender', 'telegram-sender'])

function llmConfig() {
  const provider = (process.env.AI_PROVIDER ?? 'deepseek').toLowerCase()
  if (provider === 'kimi' || provider === 'moonshot') {
    return {
      provider,
      apiKey: process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY ?? '',
      baseUrl: process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1',
      model: process.env.KIMI_MODEL ?? 'kimi-k2-0905-preview',
    }
  }
  if (provider === 'deepseek') {
    return {
      provider,
      apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    }
  }
  return {
    provider,
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  }
}

/**
 * Compact the registry into something worth spending tokens on: the name
 * the planner must emit, what the skill is for, and the exact parameter
 * names it accepts. Without the parameter names the model invents plausible
 * ones and every dispatch runs on defaults.
 */
function describeCatalogue(skills: Skill[]): string {
  return skills
    .map((s) => {
      const m = (s.manifest ?? {}) as Record<string, unknown>
      const schema = (m.input_schema ?? {}) as { properties?: Record<string, unknown> }
      const params = Object.keys(schema.properties ?? {})
      const desc = String(m.description ?? '').replace(/\s+/g, ' ').slice(0, 160)
      return `- ${s.name}: ${desc}${params.length ? ` | params: ${params.join(', ')}` : ''}`
    })
    .join('\n')
}

/**
 * Kept deliberately terse. This is a reasoning model: every extra rule is
 * something it deliberates over before answering, and an earlier eight-rule
 * version pushed some objectives past 20k characters of reasoning and out
 * of the token budget entirely — 70s, then an empty reply. The same
 * objectives plan in ~20s against this.
 */
const SYSTEM = [
  'Plan a multi-agent workflow from the catalogue. Return only JSON:',
  '{"title":string,"nodes":[{"id":string,"label":string,"skill_name":string,"depends_on":string[],"input":object}]}',
  '',
  '- skill_name: copy exactly from the catalogue. 2-4 nodes.',
  '- Data nodes have depends_on: []. The last node is report-composer with input {} and depends_on listing every other id.',
  '- input: only that agent\'s listed params, values taken from the objective. Pairs are "SOL/USDT", not "SOLUSDT". token_address is a 0x address only — given just a ticker, omit it and use a symbol/query param instead.',
  '- Only plan email-sender or telegram-sender if the objective asks to send or notify.',
].join('\n')

interface RawPlan {
  title?: unknown
  nodes?: unknown
}

/** Pull a JSON object out of a model reply that may be fenced or padded. */
function parseJsonObject(text: string): RawPlan | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1)) as RawPlan
  } catch {
    return null
  }
}

/**
 * Reject anything we would not want to execute. Returns the cleaned nodes
 * or a reason string — never a partially-valid plan, because a graph with
 * one bad edge deadlocks the executor rather than failing loudly.
 */
function validate(
  raw: RawPlan,
  known: Set<string>,
  wantsSend: boolean,
): { nodes: PlannedNode[] } | { error: string } {
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) return { error: 'no nodes in reply' }
  if (raw.nodes.length > 6) return { error: `too many nodes (${raw.nodes.length})` }

  const nodes: PlannedNode[] = []
  const ids = new Set<string>()

  for (const n of raw.nodes as Record<string, unknown>[]) {
    const id = typeof n.id === 'string' ? n.id.trim() : ''
    const skill = typeof n.skill_name === 'string' ? n.skill_name.trim() : ''
    if (!id) return { error: 'node missing id' }
    if (ids.has(id)) return { error: `duplicate node id ${id}` }
    if (!known.has(skill)) return { error: `unknown skill ${skill || '(blank)'}` }
    if (SENDER_SKILLS.has(skill) && !wantsSend) {
      return { error: `planned ${skill} but the objective never asked to send anything` }
    }
    ids.add(id)
    nodes.push({
      id,
      label: typeof n.label === 'string' && n.label.trim() ? n.label.trim() : skill,
      skill_name: skill,
      depends_on: Array.isArray(n.depends_on) ? n.depends_on.filter((d) => typeof d === 'string') : [],
      input:
        n.input && typeof n.input === 'object' && !Array.isArray(n.input)
          ? (n.input as Record<string, unknown>)
          : {},
    })
  }

  for (const n of nodes) {
    for (const dep of n.depends_on) {
      if (!ids.has(dep)) return { error: `node ${n.id} depends on unknown ${dep}` }
      if (dep === n.id) return { error: `node ${n.id} depends on itself` }
    }
  }

  // The report must exist and must be the last thing that *thinks*, but it
  // need not be the last node: "…and email me the result" legitimately ends
  // with a sender that consumes the report. Requiring report-composer to be
  // final rejected exactly the plan the objective asked for.
  const composer = nodes.find((n) => n.skill_name === 'report-composer')
  if (!composer) return { error: 'plan has no report-composer' }

  const tail = nodes[nodes.length - 1]
  if (tail.skill_name !== 'report-composer') {
    if (!SENDER_SKILLS.has(tail.skill_name)) {
      return { error: `plan ends in ${tail.skill_name}, expected report-composer or a sender` }
    }
    if (!tail.depends_on.includes(composer.id)) {
      return { error: `${tail.skill_name} must depend on the report it sends` }
    }
  }

  return { nodes }
}

/**
 * Ask the model for a plan. Throws with a readable reason on any failure
 * so the caller can record it and fall back.
 */
export async function planWithLLM(
  prompt: string,
  skills: Skill[],
): Promise<{ title: string; nodes: PlannedNode[]; model: string }> {
  const { provider, apiKey, baseUrl, model } = llmConfig()
  if (!apiKey) throw new Error(`${provider.toUpperCase()}_API_KEY not set`)

  const known = new Set(skills.map((s) => s.name))
  const wantsSend = /\b(send|email|notify|telegram|message me|dm me)\b/i.test(prompt)

  const r = await curlFetchJSON<{
    choices: { message: { content?: string }; finish_reason?: string }[]
  }>(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Agent catalogue:\n${describeCatalogue(skills)}\n\nObjective:\n${prompt}\n\nReturn the JSON plan.`,
        },
      ],
      temperature: 0.1,
      // Without this, deepseek-v4-flash reasons freely before writing and
      // on some prompts never gets to the answer: 74s of thinking, then an
      // empty body with finish_reason 'length'. JSON mode constrains it to
      // the structured answer — the same prompt then returns in ~5s with
      // finish_reason 'stop'.
      response_format: { type: 'json_object' },
      max_tokens: 8000,
    }),
    // A reasoning model thinks before it writes, and the catalogue is long.
    // At 45s the three-agent prompts were cut off mid-reasoning and came
    // back as an empty body. Planning is no longer on the request path —
    // it runs after the user has already landed on the run page — so a
    // slower, correct plan costs nothing but a few seconds of "Planning…".
    timeoutMs: 120_000,
  })

  const content = r.choices?.[0]?.message?.content?.trim() ?? ''
  if (!content) throw new Error(`empty reply (finish_reason: ${r.choices?.[0]?.finish_reason})`)

  const raw = parseJsonObject(content)
  if (!raw) throw new Error(`reply was not JSON: ${content.slice(0, 160)}`)

  const checked = validate(raw, known, wantsSend)
  if ('error' in checked) throw new Error(checked.error)

  const title =
    typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim().slice(0, 120)
      : prompt.slice(0, 80)

  return { title, nodes: checked.nodes, model }
}
