import { db } from '@/lib/db/client'
import { agents, negotiations } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { z } from 'zod'

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
        model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini', // fallback gpt-4o-mini
      }
  }
}

const config = resolveProvider()
const llm = createOpenAICompatible({
  name: PROVIDER,
  apiKey: config.apiKey,
  baseURL: config.baseURL,
})

const negotiationResponseSchema = z.object({
  priceOffer: z.number(),
  message: z.string(),
  accepted: z.boolean(),
})

export type NegotiationResponse = z.infer<typeof negotiationResponseSchema>

/**
 * Executes a round-limited negotiation step on behalf of the provider agent.
 */
export async function executeNegotiationRound(
  jobId: string,
  clientAgentId: string,
  providerAgentId: string,
  description: string,
  initialOffer: number
): Promise<NegotiationResponse> {
  // 1. Fetch historical messages for the job to determine current round
  const history = await db
    .select()
    .from(negotiations)
    .where(eq(negotiations.jobId, jobId))
    .orderBy(asc(negotiations.createdAt))

  const providerAgent = await db
    .select()
    .from(agents)
    .where(eq(agents.id, providerAgentId))
    .limit(1)
    .then((r) => r[0] || null)

  const clientAgent = await db
    .select()
    .from(agents)
    .where(eq(agents.id, clientAgentId))
    .limit(1)
    .then((r) => r[0] || null)

  if (!providerAgent || !clientAgent) {
    throw new Error('Client or Provider agent not found in database')
  }

  // Determine current negotiation round
  const providerMessages = history.filter((m) => m.agentId === providerAgentId)
  const currentRound = providerMessages.length + 1 // 1, 2, 3

  const systemPrompt = `You are ${providerAgent.name}, a Provider Agent with capabilities: ${(providerAgent.capabilities || []).join(', ')}.
You are negotiating a contract budget with Client Agent ${clientAgent.name}.
The job description is: "${description}".
The contract is currently in negotiation. This is negotiation round ${currentRound} of 3.

RULES:
1. You must negotiate a fair price (USDC) for this work.
2. If the price offered is reasonable (e.g. close to your value or fair for the description), set "accepted" to true.
3. If this is round 3 (the final round), you MUST make a final decision: either accept (accepted: true) or reject (accepted: false). Do not extend past round 3.
4. You must respond ONLY with a JSON object matching this schema:
{
  "priceOffer": number (your counter-offer or the accepted price),
  "message": "string explanation of your decision",
  "accepted": boolean (true if you accept their price or they accepted yours, false if you want to negotiate further or reject)
}`

  const chatHistoryContext = history
    .map((m) => {
      const sender = m.agentId === clientAgentId ? 'Client' : 'Provider'
      return `${sender}: "${m.message}" ${m.priceOffer ? `(Offer: ${m.priceOffer} USDC)` : ''}`
    })
    .join('\n')

  const prompt = `Here is the current negotiation history:
${chatHistoryContext || '(No negotiation history yet)'}

The initial/latest offer from Client is ${initialOffer} USDC.
Analyze the job description and history. Give your response.`

  try {
    const { text } = await generateText({
      model: llm(config.model) as unknown as Parameters<typeof generateText>[0]['model'],
      prompt,
      system: systemPrompt,
      responseFormat: { type: 'json' },
    } as unknown as Parameters<typeof generateText>[0])

    const parsed = JSON.parse(text.trim())
    return negotiationResponseSchema.parse(parsed)
  } catch (err) {
    console.error('[hermes/negotiate] LLM error, falling back to auto-accept:', err)
    // Safe fallback: accept the initial offer
    return {
      priceOffer: initialOffer,
      message: 'Agreement reached automatically.',
      accepted: true,
    }
  }
}
