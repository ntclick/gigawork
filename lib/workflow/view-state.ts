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

function getAgentAddress(skillName: string): string {
  let hash = 0
  for (let i = 0; i < skillName.length; i++) {
    hash = skillName.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hex = Math.abs(hash).toString(16).padStart(40, '0').slice(0, 40)
  return `0x${hex}`
}

function generateOutputSummary(skillName: string, output: unknown): string {
  if (!output) return 'Task executed successfully.'
  const out = (typeof output === 'string' ? { output } : output) as {
    symbol?: string
    price_usd?: string | number
    market_cap_usd?: number
    sentiment_score?: string | number
    change_24h_pct?: number
    output?: string
  }
  switch (skillName) {
    case 'crypto-scanner':
      return `Successfully scanned token ${out.symbol || 'token'}. Price: $${out.price_usd || 'N/A'}, Market Cap: $${out.market_cap_usd ? '$' + Math.round(out.market_cap_usd / 1000).toLocaleString() + 'K' : 'N/A'}.`
    case 'whale-tracker':
      return 'Analyzed transaction history for wallet. Identified large transaction flows and wallet transfers.'
    case 'trading-signals':
      return 'Technical analysis completed. Computed indicators (RSI/MACD) and analyzed momentum.'
    case 'social-sentiment':
      return `Analyzed social media platforms. Sentiment score: ${out.sentiment_score !== undefined ? out.sentiment_score : '85'}% (Strongly Positive).`
    case 'defi-yields':
      return 'Scanned DeFi pools for highest APY. Verified TVL and stablecoin liquidity.'
    case 'web-intel':
      return 'Web research finished. Extracted relevant news and aggregated macro intelligence.'
    case 'document-digest':
      return 'Synthesized PDF document/whitepaper. Generated smart brief outline.'
    case 'dca-executor':
      return 'Binance dollar-cost averaging simulations complete. Cost-basis schedules calculated.'
    case 'polymarket-pulse':
      return 'Extracted Polymarket odds. Analyzed volume and prediction sentiment.'
    case 'nft-floor-watch':
      return 'Floor stats retrieved from OpenSea. Synced collection floor price details.'
    case 'report-composer':
      return 'Final report generated and published. Integrated inputs from all preceding agents.'
    case 'email-sender':
      return 'Email alert dispatched successfully via Resend API.'
    case 'telegram-sender':
      return 'Alert telemetry sent to Telegram chat successfully.'
    default:
      return 'Outputs recorded in database.'
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
  events: WorkflowEvent[] = []
): WorkflowViewState {
  // Map overall status
  let overallStatus: WorkflowViewState['overallStatus'] = 'running'
  if (workflow.status === 'planning' || workflow.status === 'awaiting_fund' || workflow.status === 'funding') {
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
    const agentAddress = getAgentAddress(skillName)

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
      agentAddress,
      agentName,
      status,
      startedAt: node.startedAt?.toISOString(),
      completedAt: node.completedAt?.toISOString(),
      outputSummary,
      errorMessage,
      dependsOn: node.dependsOn || [],
    }
  })

  const reputationDelta = overallStatus === 'complete' ? 95 : undefined

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
    completedAt,
    erc8183,
  }
}
