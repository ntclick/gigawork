export type StepStatus = 
  | 'pending'
  | 'active'
  | 'complete'
  | 'failed'

export type EscrowStatus =
  | 'unlocked'
  | 'depositing'
  | 'locked'
  | 'releasing'
  | 'released'
  | 'refunded'

export interface WorkflowStep {
  id: string
  label: string           // human-readable, already in English
  agentAddress: string
  agentName: string
  status: StepStatus
  startedAt?: string      // ISO timestamp
  completedAt?: string
  outputSummary?: string  // 1-2 sentence summary of what the agent produced
  errorMessage?: string
  dependsOn?: string[]    // list of step IDs this step depends on
}

export type WorkflowTimelinePhase =
  | 'create'
  | 'planning'
  | 'dispatch'
  | 'payment'
  | 'settlement'
  | 'finalize'

export type WorkflowTimelineSeverity = 'info' | 'success' | 'warning' | 'error'

export interface WorkflowTimelineEvent {
  id: string
  type: string
  phase: WorkflowTimelinePhase
  severity: WorkflowTimelineSeverity
  status?: string | null
  title: string
  message?: string | null
  timestamp: string
  nodeId?: string | null
  skillName?: string | null
  agentId?: string | null
  quoteId?: string | null
  paymentId?: string | null
  txHash?: string | null
  payload: Record<string, unknown>
}

export interface WorkflowViewState {
  workflowId: string
  title: string
  overallStatus: 'planning' | 'running' | 'verifying' | 'complete' | 'failed'
  escrow: {
    status: EscrowStatus
    amountUsdc: string
    txHash?: string
  }
  steps: WorkflowStep[]
  events: WorkflowTimelineEvent[]
  reputationDelta?: number   // shown after completion
  completedAt?: string
  erc8183?: {
    jobId?: string | null
    createTx?: string | null
    setBudgetTx?: string | null
    approveTx?: string | null
    fundTx?: string | null
    submitTx?: string | null
    completeTx?: string | null
    deliverableHash?: string | null
    budgetUsdc?: string | null
    reputationTx?: string | null
  } | null
}
