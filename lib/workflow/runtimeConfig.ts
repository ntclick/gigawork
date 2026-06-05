export type WorkflowLatencyMode = 'fast' | 'balanced' | 'deep'

function modeEnv(): WorkflowLatencyMode {
  const raw = process.env.WORKFLOW_LATENCY_MODE?.toLowerCase()
  if (raw === 'fast' || raw === 'balanced' || raw === 'deep') return raw
  return 'balanced'
}

function intEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name]
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.floor(parsed))
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw == null) return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

export const workflowRuntimeConfig = {
  latencyMode: modeEnv(),
  targetMs: intEnv('WORKFLOW_TARGET_MS', 30_000),
  plannerTimeoutMs: intEnv('WORKFLOW_PLANNER_TIMEOUT_MS', 5_000),
  nodeTimeoutMs: intEnv('WORKFLOW_NODE_TIMEOUT_MS', 8_000),
  bundleTimeoutMs: intEnv('WORKFLOW_BUNDLE_TIMEOUT_MS', 12_000),
  composerTimeoutMs: intEnv('WORKFLOW_COMPOSER_TIMEOUT_MS', 8_000),
  maxNodes: intEnv('WORKFLOW_MAX_NODES', 8),
  maxDagDepth: intEnv('WORKFLOW_MAX_DAG_DEPTH', 3),
  maxParallelNodes: intEnv('WORKFLOW_MAX_PARALLEL_NODES', 5),
  chainWritesAsync: boolEnv('WORKFLOW_CHAIN_WRITES_ASYNC', true),
  slowSkillsAsync: boolEnv('WORKFLOW_SLOW_SKILLS_ASYNC', true),
} as const

export function remainingMs(deadlineMs: number): number {
  return Math.max(0, deadlineMs - Date.now())
}
