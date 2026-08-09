import { WorkflowViewState, WorkflowStep, StepStatus, EscrowStatus, WorkflowTimelineEvent } from '@/types/workflow-view'
import type { Workflow, Node as DbNode, Skill, WorkflowEvent } from '@/lib/db/schema'

export interface EscrowEvent {
  name: string
  txHash: string
  timestamp: string
}

const AGENT_NAMES: Record<string, string> = {
  'crypto-scanner': 'Birdeye On-chain Scanner',
  'whale-tracker': 'Alchemy Whale Tracker',
  'trading-signals': 'Binance Technical Analyst',
  'social-sentiment': 'LunarCrush Social Sentiment',
  'defi-yields': 'Yield Finder DeFi APY',
  'web-intel': 'Google Search Research',
  'document-digest': 'Kimi Document Digest',
  'dca-executor': 'Binance DCA Planner',
  'polymarket-pulse': 'Polymarket Gamma Predictor',
  'nft-floor-watch': 'OpenSea NFT Floor Watch',
  'report-composer': 'Moonshot Report Composer',
  'email-sender': 'Resend Mailman',
  'telegram-sender': 'Hermes Telegram Dispatcher',
}

function generateOutputSummary(skillName: string, output: unknown): string {
  if (!output) return 'Task executed successfully.'
  const out = (typeof output === 'string' ? { output } : output) as Record<string, unknown>

  switch (skillName) {
    case 'crypto-scanner': {
      const sym = (out.symbol as string) || 'TOKEN'
      const price = out.price_usd != null ? `$${Number(out.price_usd) < 0.01 ? Number(out.price_usd).toFixed(8) : Number(out.price_usd).toFixed(4)}` : 'N/A'
      const mc = out.market_cap_usd ? `$${(Number(out.market_cap_usd) / 1_000_000).toFixed(2)}M` : 'N/A'
      const lp = out.liquidity_usd ? ` · Liquidity: $${(Number(out.liquidity_usd) / 1000).toFixed(0)}K` : ''
      const ch = out.change_24h_pct != null ? ` · 24h: ${Number(out.change_24h_pct) >= 0 ? '+' : ''}${Number(out.change_24h_pct).toFixed(2)}%` : ''
      const score = out.security_score != null ? ` · Security: ${out.security_score}/100` : ''
      return `${sym} scanned. Price: ${price} · MCap: ${mc}${lp}${ch}${score}`
    }
    case 'whale-tracker': {
      const txCount = out.transaction_count || out.txCount || out.count
      const totalVal = out.total_value_usd ? `$${(Number(out.total_value_usd) / 1_000_000).toFixed(2)}M` : null
      if (txCount && totalVal) return `Tracked ${txCount} transactions · Total flow: ${totalVal}`
      if (txCount) return `Tracked ${txCount} high-value wallet transactions. Large flows identified.`
      return 'Whale wallet analysis complete. Transaction flows mapped and aggregated.'
    }
    case 'trading-signals': {
      const sym = (out.symbol as string) || ''
      const rsi = out.rsi != null ? `RSI: ${Number(out.rsi).toFixed(1)}` : null
      const macd = out.macd_histogram != null
        ? `MACD: ${Number(out.macd_histogram) > 0 ? '▲' : '▼'}${Math.abs(Number(out.macd_histogram)).toFixed(4)}`
        : null
      const signal = (out.signal as string) || (out.recommendation as string)
      const parts = [sym, rsi, macd, signal ? `Signal: ${signal}` : null].filter(Boolean)
      return parts.length > 0 ? parts.join(' · ') : 'Technical indicators computed. RSI/MACD momentum analyzed.'
    }
    case 'social-sentiment': {
      const score = out.sentiment_score != null ? `${Number(out.sentiment_score).toFixed(0)}%` : null
      const label = (out.sentiment_label as string) || (out.overall as string)
      const posM = out.positive_mentions ? `+${out.positive_mentions} bullish` : null
      const parts = [score ? `Sentiment: ${score}` : null, label, posM].filter(Boolean)
      return parts.length > 0 ? parts.join(' · ') : 'Social sentiment analyzed across platforms.'
    }
    case 'defi-yields': {
      const topYield = out.top_apy ? `Top APY: ${Number(out.top_apy).toFixed(2)}%` : null
      const poolCount = out.pool_count || (Array.isArray(out.pools) ? out.pools.length : null)
      const parts = [topYield, poolCount ? `${poolCount} pools scanned` : null].filter(Boolean)
      return parts.length > 0 ? parts.join(' · ') : 'DeFi yield pools scanned. APY and TVL data extracted.'
    }
    case 'web-intel':
      return 'Web intelligence gathered. News and market narratives aggregated.'
    case 'document-digest':
      return 'Document synthesized. Key insights extracted into structured brief.'
    case 'dca-executor':
      return 'DCA simulation complete. Cost-basis schedules and entry targets calculated.'
    case 'polymarket-pulse': {
      const count = Array.isArray(out.markets) ? out.markets.length : out.market_count
      return count ? `${count} prediction markets analyzed. Probability shifts identified.` : 'Polymarket odds extracted and volume analyzed.'
    }
    case 'nft-floor-watch':
      return 'NFT floor stats retrieved. Collection volume and floor price changes tracked.'
    case 'report-composer':
    case 'report-composer-fast':
      return 'Final report generated. All agent outputs integrated and published.'
    // Notification agents — show graceful status
    case 'email-sender': {
      if (out.warning) return `Email: ${out.warning}`
      return out.ok ? 'Email alert dispatched successfully.' : 'Email delivery attempted.'
    }
    case 'telegram-sender': {
      if (out.warning) return `Telegram: ${out.warning}`
      return out.ok ? 'Telegram alert dispatched successfully.' : 'Telegram delivery attempted.'
    }
    default:
      return 'Task outputs recorded in database.'
  }
}


function getEventPhase(type: string): WorkflowTimelineEvent['phase'] {
  if (type === 'workflow.created') return 'create'
  if (type === 'workflow.execution_started') return 'dispatch'
  if (type.startsWith('workflow.planning') || type === 'workflow.planned') return 'planning'
  if (type.startsWith('node.')) return 'dispatch'
  if (type.startsWith('x402.') || type.startsWith('payment.')) return 'payment'
  if (type.startsWith('settlement.') || type.startsWith('erc8183.') || type.startsWith('erc8004.')) return 'settlement'
  if (type.startsWith('workflow.')) return 'finalize'
  return 'dispatch'
}

function getEventSeverity(type: string, status?: string | null): WorkflowTimelineEvent['severity'] {
  const marker = `${type} ${status ?? ''}`.toLowerCase()
  if (marker.includes('failed') || marker.includes('error') || marker.includes('rejected')) return 'error'
  if (marker.includes('awaiting') || marker.includes('challenge') || marker.includes('pending')) return 'warning'
  if (
    marker.includes('completed') ||
    marker.includes('settled') ||
    marker.includes('accepted') ||
    marker.includes('authorized') ||
    marker.includes('funded') ||
    marker.includes('released')
  ) return 'success'
  return 'info'
}

function getEventTitle(type: string): string {
  switch (type) {
    case 'workflow.created': return 'Workflow created'
    case 'workflow.planning_started': return 'Planning started'
    case 'workflow.planned': return 'Workflow planned'
    case 'workflow.execution_started': return 'Execution started'
    case 'workflow.finalized': return 'Final report published'
    case 'workflow.completed': return 'Workflow completed'
    case 'workflow.failed': return 'Workflow failed'
    case 'node.queued': return 'Agent queued'
    case 'node.started': return 'Agent started'
    case 'node.tool_call_started': return 'Tool call started'
    case 'node.tool_call_completed': return 'Tool call completed'
    case 'node.completed': return 'Agent completed'
    case 'node.failed': return 'Agent failed'
    case 'x402.quote_created': return 'Payment quote created'
    case 'x402.challenge_created': return 'Payment challenge created'
    case 'x402.payment_authorized': return 'Payment authorized'
    case 'x402.payment_accepted': return 'Payment accepted'
    case 'settlement.queued': return 'Settlement queued'
    case 'settlement.settled': return 'Settlement settled'
    case 'settlement.failed': return 'Settlement failed'
    case 'payment.refunded': return 'Payment refunded'
    default:
      return type
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
  }
}

function toWorkflowTimelineEvent(event: WorkflowEvent): WorkflowTimelineEvent {
  return {
    id: event.id,
    type: event.type,
    phase: getEventPhase(event.type),
    severity: getEventSeverity(event.type, event.status),
    status: event.status,
    title: getEventTitle(event.type),
    message: event.message,
    timestamp: event.createdAt instanceof Date ? event.createdAt.toISOString() : String(event.createdAt),
    nodeId: event.nodeId,
    skillName: event.skillName,
    agentId: event.agentId,
    quoteId: event.quoteId,
    paymentId: event.paymentId,
    txHash: event.txHash,
    payload: event.payload ?? {},
  }
}

// Takes raw DB row + on-chain events → returns WorkflowViewState
// All string labels are set here, not in components
export function buildWorkflowViewState(
  workflow: Workflow,
  steps: DbNode[],
  escrowEvents: EscrowEvent[],
  agents: Skill[],
  events: WorkflowEvent[] = [],
  client?: { identityTokenId: string | null; reputationScore: number | null },
): WorkflowViewState {
  // Map overall status → 6 UX stages
  let overallStatus: WorkflowViewState['overallStatus'] = 'running'
  if (workflow.status === 'queued' || workflow.status === 'awaiting_fund' || workflow.status === 'funding') {
    overallStatus = 'thinking'
  } else if (workflow.status === 'planning') {
    overallStatus = 'planning'
  } else if (workflow.status === 'settling' || workflow.status === 'finalizing') {
    overallStatus = 'verifying'
  } else if (workflow.status === 'completed') {
    overallStatus = 'complete'
  } else if (workflow.status === 'failed') {
    overallStatus = 'failed'
  }

  // Map escrow status
  let escrowStatus: EscrowStatus = 'unlocked'
  if (workflow.erc8183CompleteTx) {
    escrowStatus = 'released'
  } else if (workflow.erc8183SubmitTx) {
    escrowStatus = 'releasing'
  } else if (workflow.erc8183FundTx) {
    escrowStatus = 'locked'
  } else if (workflow.status === 'funding' || workflow.status === 'awaiting_fund') {
    escrowStatus = 'depositing'
  } else if (workflow.status === 'failed') {
    escrowStatus = 'refunded'
  }

  // Map steps
  const workflowSteps: WorkflowStep[] = steps.map((node) => {
    let status: StepStatus = 'pending'
    if (node.status === 'completed') {
      status = 'complete'
    } else if (node.status === 'failed') {
      status = 'failed'
    } else if (node.status === 'running') {
      status = 'active'
    }

    const agentSkill = agents.find((a) => a.id === node.skillId)
    const skillName = agentSkill?.name || node.kind || 'unknown'
    const agentName = (agentSkill?.manifest as Record<string, unknown> | null)?.display_name as string || AGENT_NAMES[skillName] || skillName
    // Real ERC-8004 identity minted for this skill (all seeded skills have
    // one). This replaces the old fabricated `agentAddress`, which was just
    // a hash of the skill name dressed up as an on-chain address — the UI
    // rendered it as a "verified identity", which it never was.
    const agentTokenId = agentSkill?.agentTokenId ?? null
    // Same precedence as lib/agents/registry.ts: an explicit `price_override`
    // wins over `cost_credits`. Reading only `cost_credits` here made every
    // repriced skill show a blank price in the UI.
    const manifest = agentSkill?.manifest as Record<string, unknown> | null
    // `cost_credits` is stored as a JSON string on some rows and a number on
    // others, so it must be coerced rather than type-checked — a
    // `typeof === 'number'` guard here silently blanked the price for every
    // skill written by the repricing script.
    const num = (v: unknown): number | null => {
      if (v === undefined || v === null || v === '') return null
      const n = typeof v === 'number' ? v : parseFloat(String(v))
      return Number.isFinite(n) ? n : null
    }
    const override = num(manifest?.price_override)
    const costCredits = num(manifest?.cost_credits)
    const pricePerCall =
      override !== null
        ? override.toFixed(2)
        : costCredits !== null
          ? (costCredits / 100).toFixed(2)
          : null

    let outputSummary: string | undefined
    let errorMessage: string | undefined

    if (node.status === 'completed') {
      outputSummary = generateOutputSummary(skillName, node.output)
    } else if (node.status === 'failed') {
      const errOut = node.output as { error?: string; message?: string } | null
      errorMessage = errOut?.error || errOut?.message || 'Task execution failed.'
    }

    return {
      id: node.id,
      label: node.label,
      agentName,
      agentSlug: agentSkill?.name ?? skillName,
      agentTokenId,
      pricePerCall,
      status,
      startedAt: node.startedAt?.toISOString(),
      completedAt: node.completedAt?.toISOString(),
      outputSummary,
      errorMessage,
      dependsOn: node.dependsOn || [],
    }
  })

  // `reputationDelta` used to be hardcoded to 95 on every completed run —
  // a number with no source, rendered to users as if it were an on-chain
  // score. The real ERC-8004 signal is the reputation feedback tx, which
  // the caller can read from `erc8183.reputationTx`; per-agent scores come
  // from the registry via /api/skills. Left undefined until something
  // real backs it.
  const reputationDelta: number | undefined = undefined

  const hasErc8183Trail = !!(
    workflow.erc8183JobId ||
    workflow.erc8183CreateTx ||
    workflow.erc8183SetBudgetTx ||
    workflow.erc8183ApproveTx ||
    workflow.erc8183FundTx ||
    workflow.erc8183SubmitTx ||
    workflow.erc8183CompleteTx ||
    workflow.erc8183ReputationTx
  )

  const erc8183 = hasErc8183Trail ? {
    jobId: workflow.erc8183JobId,
    createTx: workflow.erc8183CreateTx,
    setBudgetTx: workflow.erc8183SetBudgetTx,
    approveTx: workflow.erc8183ApproveTx,
    fundTx: workflow.erc8183FundTx,
    submitTx: workflow.erc8183SubmitTx,
    completeTx: workflow.erc8183CompleteTx,
    deliverableHash: workflow.erc8183DeliverableHash,
    budgetUsdc: workflow.erc8183BudgetUsdc,
    reputationTx: workflow.erc8183ReputationTx,
  } : null

  const timelineEvents = [...events]
    .sort((a, b) => {
      const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime()
      const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime()
      return aTime - bTime
    })
    .map(toWorkflowTimelineEvent)

  let completedAt: string | undefined
  for (let i = timelineEvents.length - 1; i >= 0; i--) {
    const event = timelineEvents[i]
    if (
      event.type === 'workflow.completed' ||
      event.type === 'workflow.finalized' ||
      event.type === 'settlement.settled'
    ) {
      completedAt = event.timestamp
      break
    }
  }

  return {
    workflowId: workflow.id,
    title: workflow.prompt,
    overallStatus,
    escrow: {
      status: escrowStatus,
      amountUsdc: workflow.erc8183BudgetUsdc || '0.20',
      txHash: workflow.erc8183FundTx || undefined,
    },
    steps: workflowSteps,
    events: timelineEvents,
    reputationDelta,
    client,
    completedAt,
    erc8183,
  }
}
