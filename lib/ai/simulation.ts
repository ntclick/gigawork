import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { messages, nodes, skills, workflows } from '@/lib/db/schema'

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW PLAN TEMPLATES
// Rules:
//  1. NEVER include telegram-sender or email-sender here.
//     Those are ONLY activated post-Deploy via CronJob.
//  2. Always end every plan with report-composer as the last node
//     (depends on ALL preceding data nodes so it has full context).
//  3. Every plan must have at least 2 data-gathering nodes running in parallel.
// ─────────────────────────────────────────────────────────────────────────────
const MOCK_PLANS: Record<string, Array<{id: string; label: string; skill_name: string; depends_on: string[]; input?: Record<string, unknown>}>> = {
  // Token security audit + technical momentum → full valuation report
  'token-scanner': [
    { id: 'scanner', label: 'Scan Token On-Chain Metrics', skill_name: 'crypto-scanner', depends_on: [], input: { token_address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chain: 'ethereum' } },
    { id: 'signals', label: 'Calculate Technical Momentum', skill_name: 'trading-signals', depends_on: [], input: { symbol: 'PEPE/USDT', timeframe: '4h', exchange: 'binance' } },
    { id: 'composer', label: 'Compile Token Valuation & Security Report', skill_name: 'report-composer', depends_on: ['scanner', 'signals'], input: {} },
  ],
  // DeFi yield optimization across chains
  'defi-yield-finder': [
    { id: 'yields', label: 'Scan DeFi Yield Pools', skill_name: 'defi-yields', depends_on: [], input: { top_n: 5, min_tvl_usd: 1_000_000, stablecoin_only: true } },
    { id: 'signals', label: 'Analyze ETH Market Momentum', skill_name: 'trading-signals', depends_on: [], input: { symbol: 'ETH/USDT', timeframe: '4h' } },
    { id: 'composer', label: 'Compose Yield Optimization Report', skill_name: 'report-composer', depends_on: ['yields', 'signals'], input: {} },
  ],
  // BTC/ETH technical analysis + liquidity snapshot
  'trading-signals': [
    { id: 'btc_signals', label: 'Analyze BTC RSI & MACD', skill_name: 'trading-signals', depends_on: [], input: { symbol: 'BTC/USDT', timeframe: '4h', exchange: 'binance' } },
    { id: 'eth_signals', label: 'Analyze ETH RSI & MACD', skill_name: 'trading-signals', depends_on: [], input: { symbol: 'ETH/USDT', timeframe: '1h', exchange: 'binance' } },
    { id: 'composer', label: 'Compile Technical Market Brief', skill_name: 'report-composer', depends_on: ['btc_signals', 'eth_signals'], input: {} },
  ],
  // Whale wallet flow tracking + price correlation
  'whale-tracker': [
    { id: 'whale', label: 'Track High-Value Wallet Flows', skill_name: 'whale-tracker', depends_on: [], input: { wallet: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', network: 'eth-mainnet', limit: 25 } },
    { id: 'signals', label: 'Correlate ETH Price Momentum', skill_name: 'trading-signals', depends_on: [], input: { symbol: 'ETH/USDT', timeframe: '4h' } },
    { id: 'composer', label: 'Compose Whale Flow Analysis Report', skill_name: 'report-composer', depends_on: ['whale', 'signals'], input: {} },
  ],
  // Polymarket prediction markets + sentiment
  'market-sentiment': [
    { id: 'polymarket', label: 'Scan Prediction Market Odds', skill_name: 'polymarket-pulse', depends_on: [], input: { tag: 'crypto', limit: 5 } },
    { id: 'sentiment', label: 'Analyze Social Sentiment', skill_name: 'social-sentiment', depends_on: [], input: { query: 'bitcoin ethereum crypto market' } },
    { id: 'composer', label: 'Compose Market Sentiment Brief', skill_name: 'report-composer', depends_on: ['polymarket', 'sentiment'], input: {} },
  ],
  // General web intelligence + research
  'general-intel': [
    { id: 'intel', label: 'Search Web Intelligence', skill_name: 'web-intel', depends_on: [], input: { query: 'Latest trends in AI agent workflows and DeFi', max_results: 5 } },
    { id: 'signals', label: 'Scan BTC Market Pulse', skill_name: 'trading-signals', depends_on: [], input: { symbol: 'BTC/USDT', timeframe: '4h' } },
    { id: 'composer', label: 'Compose Research & Intelligence Report', skill_name: 'report-composer', depends_on: ['intel', 'signals'], input: {} },
  ],
}

function selectMockPlan(prompt: string) {
  const p = prompt.toLowerCase()

  // Token / crypto scanner keywords
  if (p.includes('pepe') || p.includes('token') || p.includes('scan') || p.includes('birdeye') || p.includes('crypto') || p.includes('0x6982')) {
    return { key: 'token-scanner', plan: MOCK_PLANS['token-scanner'], title: 'Token Security & Valuation Analysis Team' }
  }
  // DeFi / yield keywords
  if (p.includes('yield') || p.includes('defi') || p.includes('apy') || p.includes('pool') || p.includes('liquidity')) {
    return { key: 'defi-yield-finder', plan: MOCK_PLANS['defi-yield-finder'], title: 'DeFi Yield Optimization Team' }
  }
  // Technical signals keywords
  if (p.includes('rsi') || p.includes('macd') || p.includes('signal') || p.includes('indicator') || p.includes('technical')) {
    return { key: 'trading-signals', plan: MOCK_PLANS['trading-signals'], title: 'Technical Market Signals Team' }
  }
  // Whale tracking keywords
  if (p.includes('whale') || p.includes('wallet') || p.includes('flow') || p.includes('transfer') || p.includes('on-chain')) {
    return { key: 'whale-tracker', plan: MOCK_PLANS['whale-tracker'], title: 'Whale Tracker & Flow Analysis Team' }
  }
  // Market sentiment / prediction
  if (p.includes('sentiment') || p.includes('polymarket') || p.includes('prediction') || p.includes('social')) {
    return { key: 'market-sentiment', plan: MOCK_PLANS['market-sentiment'], title: 'Market Sentiment Intelligence Team' }
  }
  return { key: 'general-intel', plan: MOCK_PLANS['general-intel'], title: 'General Market Intelligence Team' }
}

import { analyzeUserPromptIntent } from '@/lib/ai/intentPlanner'
import type { PlannedNode } from '@/lib/ai/llmPlanner'

export async function planWorkflowForPrompt(opts: {
  workflowId: string
  userId: string | null
  prompt: string
}) {
  const { workflowId, prompt } = opts

  // Clear existing nodes/messages to avoid duplicates or collision
  await db.delete(nodes).where(eq(nodes.workflowId, workflowId))
  // Keep the seed user message but delete others
  await db.delete(messages).where(and(eq(messages.workflowId, workflowId), eq(messages.role, 'brain')))

  const skillRows = await db.select().from(skills)
  const byName = new Map(skillRows.map((s) => [s.name, s]))

  // Ask the model first. The keyword templates below are the fallback, not
  // the plan: they cannot read parameters out of the objective, which is
  // why "SOL/USDT" used to run against USDT/USDT.
  let plan: PlannedNode[]
  let title: string
  let planSource: 'llm' | 'fallback' = 'llm'
  let planModel: string | undefined
  let fallbackReason: string | undefined

  try {
    const { planWithLLM } = await import('@/lib/ai/llmPlanner')
    const r = await planWithLLM(prompt, skillRows)
    plan = r.nodes
    title = r.title
    planModel = r.model
  } catch (e) {
    fallbackReason = e instanceof Error ? e.message : String(e)
    console.warn('[planner] LLM planning failed, using keyword template:', fallbackReason)
    planSource = 'fallback'
    const t = analyzeUserPromptIntent(prompt)
    plan = t.plan
    title = t.title
  }

  const rows = plan.map((p) => ({
    workflowId,
    kind: 'skill_call',
    label: p.label,
    skillId: byName.get(p.skill_name)?.id ?? null,
    status: 'pending',
    dependsOn: p.depends_on,
    input: p.input ?? {},
  }))

  const inserted = await db.insert(nodes).values(rows).returning()

  await db
    .update(workflows)
    .set({ status: 'queued' })
    .where(eq(workflows.id, workflowId))

  const out = {
    nodes: inserted.map((n, i) => ({
      node_id: n.id,
      plan_id: plan[i].id,
      label: n.label,
      skill_name: plan[i].skill_name,
      depends_on: plan[i].depends_on,
      input: n.input ?? {},
    })),
  }

  // Persist the plan tool result message so WorkflowCanvas parses it
  await db.insert(messages).values({
    workflowId,
    role: 'system',
    toolName: 'planWorkflow',
    toolPayload: { input: { nodes: plan }, output: out },
    content: null,
  })

  // No reputation message is written here on purpose.
  //
  // This runs at PLANNING time — the workflow has just been set to
  // `queued` above and not one agent has executed. There is no outcome to
  // score yet. Worse, `reputationUpdate` is the idempotency key for the
  // real post-run write: both `cacheReputation` and the reconcile
  // endpoint bail the moment a row with that toolName exists. Emitting a
  // placeholder here meant every simulation-planned workflow — which is
  // most of them, since the planner falls back to simulation whenever the
  // LLM is unavailable — permanently blocked its own ERC-8004 scoring,
  // for the providers and for the client alike. The run simply reported
  // "reputation has not been written on-chain yet" forever.

  // The old text here claimed "LLM API key quota exceeded (suspended or
  // out of balance)" and "Offline Simulation Mode". None of it was true —
  // no LLM had been called, so no quota could have been exceeded, and the
  // agents that ran were the real ones hitting real APIs. It was a fixed
  // string dressed up as a diagnosis. Say what actually happened instead.
  const steps = plan
    .map(
      (n, i) =>
        `${i + 1}. **${n.label}** (${n.skill_name})${
          n.depends_on.length > 0 ? ` — *after: ${n.depends_on.join(', ')}*` : ''
        }`,
    )
    .join('\n')

  const header =
    planSource === 'llm'
      ? `**${title}**\n\nPlanned by ${planModel} from your objective:`
      : `⚠️ **Planned from a keyword template.** The model could not produce a usable plan (${fallbackReason ?? 'unknown reason'}), so this fell back to a preset for **${title}**. Its agent parameters come from the template, not from your wording — check them before running.`

  const simulatedText = `${header}\n\n${steps}\n\nPress **▶ Run** to dispatch this workforce.`

  // Persist brain message for history
  await db.insert(messages).values({
    workflowId,
    role: 'brain',
    content: simulatedText,
  })

  return simulatedText
}
