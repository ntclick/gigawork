import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { messages, nodes, skills, workflows } from '@/lib/db/schema'

const MOCK_PLANS: Record<string, Array<{id: string; label: string; skill_name: string; depends_on: string[]; input?: Record<string, unknown>}>> = {
  'token-scanner-telegram': [
    { id: 'scanner', label: 'Scan Token Metrics', skill_name: 'crypto-scanner', depends_on: [], input: { token_address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chain: 'ethereum' } },
    { id: 'composer', label: 'Compile Analysis Report', skill_name: 'report-composer', depends_on: ['scanner'], input: {} },
    { id: 'telegram', label: 'Send Alert via Telegram', skill_name: 'telegram-sender', depends_on: ['composer'], input: {} }
  ],
  'defi-yield-finder': [
    { id: 'yields', label: 'Scan DeFi Pools', skill_name: 'defi-yields', depends_on: [], input: { top_n: 5, min_tvl_usd: 1000000, stablecoin_only: true } },
    { id: 'composer', label: 'Compose Profit Optimization Report', skill_name: 'report-composer', depends_on: ['yields'], input: {} }
  ],
  'trading-signals-email': [
    { id: 'signals', label: 'Calculate RSI/MACD Indicators', skill_name: 'trading-signals', depends_on: [], input: { symbol: 'BTC/USDT', timeframe: '4h', exchange: 'binance' } },
    { id: 'composer', label: 'Compile Signals Report', skill_name: 'report-composer', depends_on: ['signals'], input: {} },
    { id: 'email', label: 'Send Report via Email', skill_name: 'email-sender', depends_on: ['composer'], input: {} }
  ],
  'whale-tracker-report': [
    { id: 'whale', label: 'Track Whale Transactions', skill_name: 'whale-tracker', depends_on: [], input: { wallet: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503', network: 'eth-mainnet', limit: 25 } },
    { id: 'composer', label: 'Compose Flow Analysis Report', skill_name: 'report-composer', depends_on: ['whale'], input: {} }
  ],
  'general-intel': [
    { id: 'intel', label: 'Search Web Intelligence', skill_name: 'web-intel', depends_on: [], input: { query: 'Latest trends in AI agent workflows', max_results: 5 } },
    { id: 'composer', label: 'Compose Research Report', skill_name: 'report-composer', depends_on: ['intel'], input: {} }
  ]
}

function selectMockPlan(prompt: string) {
  const p = prompt.toLowerCase()
  if (p.includes('birdeye') || p.includes('crypto-scanner') || p.includes('0x6982') || p.includes('telegram')) {
    return { key: 'token-scanner-telegram', plan: MOCK_PLANS['token-scanner-telegram'], title: 'Token Scanner & Telegram Alert Team' }
  }
  if (p.includes('yield') || p.includes('defi-yields') || p.includes('apy')) {
    return { key: 'defi-yield-finder', plan: MOCK_PLANS['defi-yield-finder'], title: 'DeFi Yield APY Hunter Team' }
  }
  if (p.includes('signals') || p.includes('rsi') || p.includes('macd') || p.includes('trading-signals')) {
    return { key: 'trading-signals-email', plan: MOCK_PLANS['trading-signals-email'], title: 'Technical Signals Reporter Team' }
  }
  if (p.includes('whale') || p.includes('0x47ac')) {
    return { key: 'whale-tracker-report', plan: MOCK_PLANS['whale-tracker-report'], title: 'Whale Tracker & Flow Analyst Team' }
  }
  return { key: 'general-intel', plan: MOCK_PLANS['general-intel'], title: 'General Web Intelligence Team' }
}

export async function runLocalWorkflowPlanningSimulation(opts: {
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

  const { plan, title } = selectMockPlan(prompt)

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
    .set({ status: 'planning' })
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

  // Persist reputation update as skipped
  await db.insert(messages).values({
    workflowId,
    role: 'system',
    toolName: 'reputationUpdate',
    toolPayload: {
      tx: null,
      tokenIds: [],
      status: 'skipped',
      outcome: 'simulated',
      reason: 'Offline Simulation Mode activated.',
    },
    content: null,
  })

  const simulatedText = `⚠️ **[Simulation Mode Active]** LLM API key quota exceeded (suspended or out of balance). 

Hermes AI Planner has automatically activated **Offline Simulation Mode** and generated a plan for the **${title}** template:

${plan.map((n, i) => `${i + 1}. **${n.label}** (${n.skill_name})${n.depends_on.length > 0 ? ` — *depends on: ${n.depends_on.join(', ')}*` : ''}`).join('\n')}

Click **▶ Activate** or **▶ Run** below to execute this Multi-Agent graph using local simulator engines.`

  // Persist brain message for history
  await db.insert(messages).values({
    workflowId,
    role: 'brain',
    content: simulatedText,
  })

  return simulatedText
}
