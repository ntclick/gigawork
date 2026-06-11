import { deepEqual, equal } from 'node:assert/strict'

import { buildWorkflowViewState } from '../lib/workflow/view-state'
import type { Node as DbNode, Skill, Workflow, WorkflowEvent } from '../lib/db/schema'

const workflow = {
  id: '11111111-1111-4111-8111-111111111111',
  prompt: 'Research ETH market and compose a report',
  status: 'running',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  erc8183JobId: null,
  erc8183CreateTx: null,
  erc8183SetBudgetTx: null,
  erc8183ApproveTx: null,
  erc8183FundTx: null,
  erc8183SubmitTx: null,
  erc8183CompleteTx: null,
  erc8183DeliverableHash: null,
  erc8183BudgetUsdc: '0.05',
  erc8183ReputationTx: null,
} as unknown as Workflow

const step = {
  id: '22222222-2222-4222-8222-222222222222',
  workflowId: workflow.id,
  skillId: '33333333-3333-4333-8333-333333333333',
  label: 'Scan ETH',
  kind: 'agent',
  status: 'running',
  input: { token_address: '0xeeee' },
  output: null,
  dependsOn: [],
  startedAt: new Date('2026-01-01T00:01:00.000Z'),
  completedAt: null,
  timing: null,
  createdAt: new Date('2026-01-01T00:00:30.000Z'),
} as unknown as DbNode

const skill = {
  id: step.skillId,
  name: 'crypto-scanner',
  manifest: { display_name: 'ETH Scanner' },
  agentTokenId: 'agent-token-7',
} as unknown as Skill

const events = [
  {
    id: '44444444-4444-4444-8444-444444444444',
    workflowId: workflow.id,
    nodeId: step.id,
    skillName: 'crypto-scanner',
    agentId: 'agent-token-7',
    type: 'node.started',
    status: 'running',
    message: 'ETH Scanner started',
    payload: { dependsOn: [] },
    quoteId: 'quote-eth-scan',
    paymentId: 'payment-eth-scan',
    txHash: '0xabc123',
    createdAt: new Date('2026-01-01T00:01:01.000Z'),
  },
] as unknown as WorkflowEvent[]

const state = buildWorkflowViewState(workflow, [step], [], [skill], events)

equal(state.events.length, 1)
deepEqual(state.events[0], {
  id: '44444444-4444-4444-8444-444444444444',
  type: 'node.started',
  phase: 'dispatch',
  severity: 'info',
  status: 'running',
  title: 'Agent started',
  message: 'ETH Scanner started',
  timestamp: '2026-01-01T00:01:01.000Z',
  nodeId: step.id,
  skillName: 'crypto-scanner',
  agentId: 'agent-token-7',
  quoteId: 'quote-eth-scan',
  paymentId: 'payment-eth-scan',
  txHash: '0xabc123',
  payload: { dependsOn: [] },
})

console.log('workflow view-state events test passed')
