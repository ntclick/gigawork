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
  agentName: string
  // Registry slug (`skills.name`) — the key to join against /api/skills for
  // reputation and lifetime call count. `agentName` is the display name and
  // does not match anything.
  agentSlug?: string
  // Real ERC-8004 identity token minted for this skill, or null. There is
  // deliberately no `agentAddress` — the previous one was fabricated from
  // a hash of the skill name and must never be shown as on-chain identity.
  agentTokenId?: string | null
  pricePerCall?: string | null  // x402 price in USDC, from the skill manifest
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
  overallStatus: 'thinking' | 'planning' | 'hiring' | 'running' | 'verifying' | 'complete' | 'failed'
  escrow: {
    status: EscrowStatus
    amountUsdc: string
    txHash?: string
  }
  steps: WorkflowStep[]
  events: WorkflowTimelineEvent[]
  reputationDelta?: number   // shown after completion

  /**
   * The hiring side of the job. Under ERC-8004 the client is an agent too:
   * it holds its own identity NFT and earns its own reputation for paying
   * and specifying work well. The UI previously showed only the providers,
   * so nothing on screen said which agent was doing the hiring.
   */
  client?: {
    identityTokenId: string | null
    reputationScore: number | null
  }
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
