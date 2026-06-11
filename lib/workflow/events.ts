import { db } from '@/lib/db/client'
import { workflowEvents, type WorkflowEvent } from '@/lib/db/schema'

export type WorkflowEventType =
  | 'workflow.created'
  | 'workflow.planning_started'
  | 'workflow.planned'
  | 'workflow.execution_started'
  | 'workflow.finalizing'
  | 'workflow.finalized'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'node.queued'
  | 'node.started'
  | 'node.tool_call_started'
  | 'node.tool_call_completed'
  | 'node.completed'
  | 'node.failed'
  | 'x402.quote_created'
  | 'x402.challenge_created'
  | 'x402.payment_authorized'
  | 'x402.payment_accepted'
  | 'settlement.queued'
  | 'settlement.settled'
  | 'settlement.failed'
  | 'payment.refunded'
  | (string & {})

export interface EmitWorkflowEventInput {
  workflowId: string
  nodeId?: string | null
  skillName?: string | null
  agentId?: string | null
  type: WorkflowEventType
  status?: string | null
  message?: string | null
  payload?: Record<string, unknown>
  quoteId?: string | null
  paymentId?: string | null
  txHash?: string | null
}

const MAX_EVENT_MESSAGE_CHARS = 500
const MAX_EVENT_STRING_CHARS = 1_000
const MAX_EVENT_PAYLOAD_CHARS = 16_000
const MAX_EVENT_PAYLOAD_DEPTH = 5
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|bearer|bot[_-]?token|passwd|password|private[_-]?key|secret|token)/i

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}…[truncated]`
}

function sanitizeEventValue(value: unknown, key = '', depth = 0): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]'
  if (value == null) return value
  if (typeof value === 'string') return truncateString(value, MAX_EVENT_STRING_CHARS)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (depth >= MAX_EVENT_PAYLOAD_DEPTH) return '[truncated:max-depth]'
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeEventValue(item, key, depth + 1))
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 100)
    return Object.fromEntries(
      entries.map(([childKey, childValue]) => [
        childKey,
        sanitizeEventValue(childValue, childKey, depth + 1),
      ]),
    )
  }
  return String(value)
}

function sanitizeEventPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const sanitized = sanitizeEventValue(payload ?? {}) as Record<string, unknown>
  const serialized = JSON.stringify(sanitized)
  if (serialized.length <= MAX_EVENT_PAYLOAD_CHARS) return sanitized

  return {
    truncated: true,
    originalChars: serialized.length,
    preview: serialized.slice(0, MAX_EVENT_PAYLOAD_CHARS),
  }
}

export async function emitWorkflowEvent(input: EmitWorkflowEventInput): Promise<WorkflowEvent | null> {
  try {
    const [event] = await db
      .insert(workflowEvents)
      .values({
        workflowId: input.workflowId,
        nodeId: input.nodeId ?? null,
        skillName: input.skillName ?? null,
        agentId: input.agentId ?? null,
        type: input.type,
        status: input.status ?? null,
        message: input.message ? truncateString(input.message, MAX_EVENT_MESSAGE_CHARS) : null,
        payload: sanitizeEventPayload(input.payload),
        quoteId: input.quoteId ?? null,
        paymentId: input.paymentId ?? null,
        txHash: input.txHash ?? null,
      })
      .returning()
    return event ?? null
  } catch (err) {
    // Observability must not break the hot path, especially while a deploy is
    // rolling out before the migration is applied. Surface enough context for
    // operators, but keep workflow creation/dispatch alive.
    console.warn('[workflow-events] emit failed', {
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      type: input.type,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
