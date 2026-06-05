# 30s Dynamic Workflow Runtime Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make normal GigaWork v2 workflows produce a user-visible dynamic-data report in ~30 seconds without bypassing paid agent x402 boundaries.

**Architecture:** Collapse many tiny DAG nodes into a few dynamic data bundle agents, execute independent bundles in parallel with strict latency budgets, generate one fast report, and move x402 settlement / ERC-8183 / ERC-8004 writes to asynchronous jobs. The hot path returns the report; the cold path completes audit, payment, reputation, and validation evidence.

**Tech Stack:** Next.js 16, TypeScript, Drizzle/Postgres, pnpm, viem, current x402-like code in `lib/chain/nanopayments.ts`, skill endpoints in `app/api/agents/[name]/route.ts`.

---

## Success Criteria

### User-visible SLO

```txt
Fast workflow p50 <= 15s
Fast workflow p90 <= 30s
Fast workflow p95 <= 45s
Hard user-visible deadline = 30s partial report
Full on-chain/audit trail may settle async after report
```

### Functional Criteria

- Normal dynamic-data workflow uses **3–5 nodes**, not 10–15 micro nodes.
- Data APIs run dynamically and in parallel inside bundle agents.
- Planner creates executable node inputs once; executor does not call LLM per node.
- Ready DAG nodes execute in parallel with concurrency limit.
- Slow sources return partial/fallback instead of blocking past the 30s deadline.
- Paid bundle agents still go through `/api/agents/[name]` x402 boundary.
- ERC-8183 settlement, ERC-8004 reputation, ERC-8004 validation run async after report.
- Every node records timing, source status, partial/failure reason, input hash, output hash.

---

## Target Hot Path

```txt
POST /api/workflow
  -> create workflow row
  -> fast planner/router: <= 3-5s
  -> create executable DAG with prebuilt node inputs
  -> execute dynamic data bundles in parallel: <= 8-12s
  -> compose report: <= 5-8s
  -> persist report + mark user-visible completed
  -> return/stream report within ~30s

Async after report:
  -> x402 settlement / receipts
  -> ERC-8183 submit/complete
  -> ERC-8004 giveFeedback / validation attestations
  -> notification dispatch if slow
```

---

## Fast Workflow Shape

Preferred 30s dynamic workflow:

```txt
1. fast-intent-router / planner
2. market-data-bundle
3. onchain-data-bundle, optional
4. social-lite-bundle, optional
5. report-composer-fast
```

Avoid:

```txt
price node
volume node
liquidity node
holders node
sentiment node
web search node
LLM mapper per node
sync chain settlement per node
```

---

## Runtime Budget

```txt
Planner/router:          5_000 ms max
Payment manifest:        1_000 ms max
Data bundle layer:       12_000 ms max
Report composer:         8_000 ms max
DB final status write:   1_000 ms max
Total hard deadline:     30_000 ms
```

Config values to add:

```txt
WORKFLOW_LATENCY_MODE=fast
WORKFLOW_TARGET_MS=30000
WORKFLOW_PLANNER_TIMEOUT_MS=5000
WORKFLOW_NODE_TIMEOUT_MS=8000
WORKFLOW_BUNDLE_TIMEOUT_MS=12000
WORKFLOW_COMPOSER_TIMEOUT_MS=8000
WORKFLOW_MAX_NODES=8
WORKFLOW_MAX_DAG_DEPTH=3
WORKFLOW_MAX_PARALLEL_NODES=5
WORKFLOW_CHAIN_WRITES_ASYNC=1
WORKFLOW_SLOW_SKILLS_ASYNC=1
```

---

# Phase 0 — Baseline and Safety

## Task 0.1: Capture current baseline

**Objective:** Record current branch, lint/build status, and workflow runtime before code changes.

**Files:**
- Read: `package.json`
- Read: `app/api/workflow/[id]/execute/route.ts`
- Read: `lib/skills/handlers.ts`
- Read: `lib/ai/finalizeWorkflow.ts`

**Commands:**

```bash
git status --short
git branch --show-current
pnpm lint
pnpm build
```

**Expected:**

- Branch/status captured in implementation notes.
- Lint/build baseline known. If baseline fails, document exact errors before touching code.

**Commit:** none.

---

## Task 0.2: Add a simple fast workflow timing script

**Objective:** Create a repeatable script to measure runtime of a workflow execution path.

**Files:**
- Create: `scripts/bench-fast-workflow.ts`
- Modify: `package.json`

**Implementation:**

Add script:

```json
"bench:workflow-fast": "tsx scripts/bench-fast-workflow.ts"
```

Script behavior:

```ts
const started = Date.now()
// call local execution function or HTTP endpoint depending on environment
// print phase timings: planner_ms, execution_ms, composer_ms, total_ms
console.log(JSON.stringify({ total_ms: Date.now() - started }, null, 2))
```

If direct local execution is not easy yet, start with a placeholder that prints a clear error and is completed in Phase 3 after executor extraction.

**Verify:**

```bash
pnpm bench:workflow-fast
```

Expected either:

```txt
{ "total_ms": ... }
```

or explicit TODO error:

```txt
bench-fast-workflow requires executor extraction from Phase 3
```

**Commit:**

```bash
git add package.json scripts/bench-fast-workflow.ts
git commit -m "chore: add fast workflow benchmark entrypoint"
```

---

# Phase 1 — Latency Config and Timing Instrumentation

## Task 1.1: Add workflow runtime config module

**Objective:** Centralize latency-mode settings instead of scattering magic numbers.

**Files:**
- Create: `lib/workflow/runtimeConfig.ts`

**Implementation:**

```ts
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw == null) return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

export const workflowRuntimeConfig = {
  latencyMode: process.env.WORKFLOW_LATENCY_MODE ?? 'balanced',
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
```

**Verify:**

```bash
pnpm lint
```

Expected: pass or only baseline errors.

**Commit:**

```bash
git add lib/workflow/runtimeConfig.ts
git commit -m "feat: add workflow latency runtime config"
```

---

## Task 1.2: Add timing helpers

**Objective:** Make every workflow phase measurable.

**Files:**
- Create: `lib/workflow/timing.ts`

**Implementation:**

```ts
export type TimingEvent = {
  name: string
  startedAt: string
  endedAt: string
  durationMs: number
  ok: boolean
  metadata?: Record<string, unknown>
}

export async function timed<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<{ value: T; event: TimingEvent }> {
  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  try {
    const value = await fn()
    const ended = Date.now()
    return {
      value,
      event: {
        name,
        startedAt,
        endedAt: new Date(ended).toISOString(),
        durationMs: ended - started,
        ok: true,
        metadata,
      },
    }
  } catch (error) {
    const ended = Date.now()
    const event = {
      name,
      startedAt,
      endedAt: new Date(ended).toISOString(),
      durationMs: ended - started,
      ok: false,
      metadata: {
        ...metadata,
        error: error instanceof Error ? error.message : String(error),
      },
    }
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { timingEvent: event })
  }
}

export async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  try {
    return await fn(ctrl.signal)
  } finally {
    clearTimeout(timer)
  }
}
```

**Verify:**

```bash
pnpm lint
```

**Commit:**

```bash
git add lib/workflow/timing.ts
git commit -m "feat: add workflow timing utilities"
```

---

# Phase 2 — Data Bundle Agents

## Task 2.1: Extract bundle helper for parallel source fetching

**Objective:** Support dynamic data sources inside one agent node without failing the whole bundle on one source error.

**Files:**
- Create: `lib/skills/bundles/sourceRunner.ts`

**Implementation:**

```ts
export type SourceResult<T = unknown> = {
  source: string
  ok: boolean
  durationMs: number
  data?: T
  error?: string
}

export async function runSource<T>(
  source: string,
  fn: () => Promise<T>,
): Promise<SourceResult<T>> {
  const started = Date.now()
  try {
    const data = await fn()
    return { source, ok: true, durationMs: Date.now() - started, data }
  } catch (e) {
    return {
      source,
      ok: false,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function summarizeSources(results: SourceResult[]): {
  ok: string[]
  failed: { source: string; error: string }[]
  partial: boolean
} {
  return {
    ok: results.filter((r) => r.ok).map((r) => r.source),
    failed: results.filter((r) => !r.ok).map((r) => ({ source: r.source, error: r.error ?? 'unknown' })),
    partial: results.some((r) => !r.ok),
  }
}
```

**Verify:**

```bash
pnpm lint
```

**Commit:**

```bash
git add lib/skills/bundles/sourceRunner.ts
git commit -m "feat: add dynamic data source runner"
```

---

## Task 2.2: Create `market-data-bundle` handler

**Objective:** Replace many tiny market-data nodes with one bundle that fetches multiple live sources in parallel.

**Files:**
- Create: `lib/skills/bundles/marketDataBundle.ts`
- Modify: `lib/skills/handlers.ts`
- Modify: `lib/nanopayments/config.ts`

**Behavior:**

Input:

```ts
{
  token_address?: string
  symbol?: string
  chain?: string
  include?: string[]
}
```

Output:

```ts
{
  bundle: 'market-data-bundle',
  subject: string,
  chain: string,
  partial: boolean,
  sources_ok: string[],
  sources_failed: { source: string; error: string }[],
  data: {
    crypto_scanner?: unknown,
    defi_yields?: unknown,
    trading_signals?: unknown,
    polymarket_pulse?: unknown
  },
  generated_at: string
}
```

Implementation approach:

- Reuse existing `SKILLS['crypto-scanner']`, `SKILLS['defi-yields']`, `SKILLS['trading-signals']`, `SKILLS['polymarket-pulse']` internally **inside the bundle handler**.
- Run them with `Promise.allSettled` / `runSource`.
- Keep each source optional and partial.
- Do not call LLM here.

Important compliance note:

- The bundle itself is the paid x402 endpoint.
- Internal data source calls are implementation details of that paid bundle.
- Do not expose each internal source as a separate paid sub-agent unless it has a separate owner/reputation/payment requirement.

**Verify:**

```bash
pnpm lint
pnpm build
```

Manual endpoint smoke test after server starts:

```bash
curl -sS -X POST http://localhost:3000/api/agents/market-data-bundle \
  -H 'content-type: application/json' \
  -d '{"symbol":"BTC","chain":"ethereum"}'
```

Expected without payment: 402 challenge if x402 is enabled.

**Commit:**

```bash
git add lib/skills/bundles/marketDataBundle.ts lib/skills/handlers.ts lib/nanopayments/config.ts
git commit -m "feat: add market data bundle agent"
```

---

## Task 2.3: Create `social-lite-bundle` handler

**Objective:** Provide fast dynamic sentiment without waiting for 60–90s Apify scrapers.

**Files:**
- Create: `lib/skills/bundles/socialLiteBundle.ts`
- Modify: `lib/skills/handlers.ts`
- Modify: `lib/nanopayments/config.ts`

**Behavior:**

- Use fast/free sources first, e.g. Reddit JSON with <= 8s timeout.
- If `WORKFLOW_SLOW_SKILLS_ASYNC=1`, skip Twitter Apify and return `slow_sources_deferred: ['twitter_apify']`.
- If user explicitly requests deep mode, allow Apify outside 30s mode.

Output includes:

```ts
{
  bundle: 'social-lite-bundle',
  partial: boolean,
  slow_sources_deferred: string[],
  sources_ok: string[],
  sources_failed: { source: string; error: string }[],
  sentiment_score: number | null,
  sample_posts: unknown[],
  generated_at: string
}
```

**Verify:**

```bash
pnpm lint
pnpm build
```

**Commit:**

```bash
git add lib/skills/bundles/socialLiteBundle.ts lib/skills/handlers.ts lib/nanopayments/config.ts
git commit -m "feat: add fast social lite bundle agent"
```

---

## Task 2.4: Create `report-composer-fast` mode

**Objective:** Guarantee a report is returned even when LLM composer is slow.

**Files:**
- Modify: `lib/skills/handlers.ts`
- Optional create: `lib/skills/bundles/reportComposerFast.ts`

**Behavior:**

- Keep existing `report-composer`, but add `fast: true` input support or create `report-composer-fast` endpoint.
- In fast mode:
  - timeout <= `WORKFLOW_COMPOSER_TIMEOUT_MS`
  - max tokens <= 700–900
  - if LLM fails or times out, return deterministic markdown from existing `buildDeterministicReport(...)` path.

**Verify:**

```bash
pnpm lint
pnpm build
```

**Commit:**

```bash
git add lib/skills/handlers.ts lib/skills/bundles/reportComposerFast.ts lib/nanopayments/config.ts
git commit -m "feat: add fast report composer behavior"
```

---

# Phase 3 — Planner Produces Executable Inputs Once

## Task 3.1: Define compiled workflow schema

**Objective:** Make planner output deterministic and directly executable.

**Files:**
- Create: `lib/workflow/compiledPlan.ts`

**Implementation:**

```ts
import { z } from 'zod'

export const compiledNodeSchema = z.object({
  id: z.string().min(1),
  skill_name: z.string().min(1),
  label: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
  input: z.record(z.string(), z.unknown()).default({}),
  timeout_ms: z.number().int().positive().optional(),
  optional: z.boolean().default(false),
})

export const compiledWorkflowSchema = z.object({
  mode: z.enum(['fast', 'balanced', 'deep']).default('fast'),
  max_expected_ms: z.number().int().positive().optional(),
  nodes: z.array(compiledNodeSchema).min(1),
  final_report_node: z.string().optional(),
})

export type CompiledNode = z.infer<typeof compiledNodeSchema>
export type CompiledWorkflow = z.infer<typeof compiledWorkflowSchema>
```

**Verify:**

```bash
pnpm lint
```

**Commit:**

```bash
git add lib/workflow/compiledPlan.ts
git commit -m "feat: define compiled workflow schema"
```

---

## Task 3.2: Add fast planner prompt rules

**Objective:** Stop planner from producing verbose reasoning and too many micro nodes in fast mode.

**Files:**
- Modify: `lib/ai/prompts.ts`
- Modify: `lib/ai/brain.ts` if planner parser lives there

**Rules to add:**

```txt
FAST WORKFLOW MODE:
- Return compact JSON only.
- Do not include reasoning prose.
- Prefer 3-5 capability bundle nodes.
- Maximum nodes: 8.
- Maximum DAG depth: 3.
- Use bundle agents for dynamic data:
  - market-data-bundle
  - social-lite-bundle
  - report-composer-fast/report-composer
- Each node must include executable input object.
- Do not create separate nodes for price, volume, liquidity, holders, or similar fields.
- Slow/deep research must be marked optional or deferred.
```

**Verify:**

- Run a local planner call or existing workflow creation with a crypto-market prompt.
- Confirm plan has <= 5 nodes and each node has `input`.

Command:

```bash
pnpm lint
```

**Commit:**

```bash
git add lib/ai/prompts.ts lib/ai/brain.ts
git commit -m "feat: add fast workflow planning constraints"
```

---

## Task 3.3: Persist planner-provided node input

**Objective:** Avoid LLM per-node input generation by storing each node's executable input.

**Files:**
- Modify: `lib/db/schema.ts`
- Create migration through Drizzle
- Modify code that inserts `nodes`

**Schema change:**

Add to `nodes` table:

```ts
input: jsonb('input'),
startedAt: timestamp('started_at', { withTimezone: true }),
completedAt: timestamp('completed_at', { withTimezone: true }),
timing: jsonb('timing'),
```

**Generate migration:**

```bash
pnpm db:generate
```

**Apply locally/staging:**

```bash
pnpm db:push
```

**Verify:**

- New columns exist.
- Existing workflows still load.

**Commit:**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat: persist executable node inputs and timing"
```

---

# Phase 4 — Parallel DAG Executor

## Task 4.1: Extract executor from API route

**Objective:** Make workflow execution testable and worker-ready instead of embedded in Next route.

**Files:**
- Create: `lib/workflow/executor.ts`
- Modify: `app/api/workflow/[id]/execute/route.ts`

**Implementation:**

Move current `runBackgroundExecution(...)` / `executeSingleNode(...)` logic from route into `lib/workflow/executor.ts`.

Export:

```ts
export async function executeWorkflowRun(args: {
  workflowId: string
  userId: string | null
  deadlineMs?: number
}): Promise<void>
```

Route becomes thin:

```ts
executeWorkflowRun({ workflowId: id, userId }).catch(...)
return NextResponse.json({ ok: true, workflowId: id })
```

This task should not change behavior yet.

**Verify:**

```bash
pnpm lint
pnpm build
```

**Commit:**

```bash
git add lib/workflow/executor.ts app/api/workflow/[id]/execute/route.ts
git commit -m "refactor: extract workflow executor from API route"
```

---

## Task 4.2: Replace sequential ready-node loop with parallel layer execution

**Objective:** Run independent nodes concurrently.

**Files:**
- Modify: `lib/workflow/executor.ts`

**Algorithm:**

```ts
while (pending nodes exist) {
  ready = pending.filter(depends satisfied)
  batch = ready.slice(0, maxParallelNodes)
  await Promise.allSettled(batch.map(executeNode))
  mark successes/failures
  continue
}
```

Rules:

- Use `workflowRuntimeConfig.maxParallelNodes`.
- Optional node failure does not fail entire workflow.
- Required node failure fails workflow unless partial-report policy says continue.
- If no ready nodes and pending remains, fail with dependency cycle/stuck error.

**Verify:**

- Add a temporary/mock benchmark that simulates 5 nodes sleeping 3s each.
- Parallel runtime should be close to 3–6s, not 15s.

Command:

```bash
pnpm bench:workflow-fast
pnpm lint
```

**Commit:**

```bash
git add lib/workflow/executor.ts scripts/bench-fast-workflow.ts
git commit -m "feat: execute ready workflow nodes in parallel"
```

---

## Task 4.3: Remove LLM per-node input mapping from executor hot path

**Objective:** Executor should use stored `nodes.input` or compiled plan input, not call `generateText(...)` per node.

**Files:**
- Modify: `lib/workflow/executor.ts`
- Modify old code path in `app/api/workflow/[id]/execute/route.ts` if still present

**Implementation:**

Node input resolution order:

```txt
1. node.input from DB
2. deterministic merge of parent outputs when explicitly configured
3. fail with clear error: missing executable input
```

Do not call LLM here.

**Verify:**

Search must not find `generateText(` inside executor:

```bash
# use project search/IDE; terminal grep is okay locally but Hermes should use search_files
pnpm lint
pnpm build
```

**Commit:**

```bash
git add lib/workflow/executor.ts app/api/workflow/[id]/execute/route.ts
git commit -m "feat: use planner-provided node inputs during execution"
```

---

## Task 4.4: Enforce node deadlines and partial results

**Objective:** No single node can consume the full 30s budget.

**Files:**
- Modify: `lib/workflow/executor.ts`
- Modify: `lib/workflow/timing.ts`

**Behavior:**

- Each node timeout = min(node.timeout_ms, config.nodeTimeoutMs, remaining workflow budget - composer reserve).
- Timeout produces node output:

```json
{
  "partial": true,
  "error": "timeout_budget_exceeded",
  "generated_at": "..."
}
```

- Optional node timeout does not fail workflow.
- Required node timeout can still allow partial report if `latencyMode === 'fast'`.

**Verify:**

- Benchmark with one mock 20s node and target 30s.
- Workflow returns partial without waiting 20s if node timeout is 8s.

**Commit:**

```bash
git add lib/workflow/executor.ts lib/workflow/timing.ts
git commit -m "feat: enforce node timeout budget"
```

---

# Phase 5 — x402 Boundary and Payment Hot Path

## Task 5.1: Make paid skills HTTP-only in executor

**Objective:** Prevent monetized skills from being called in-process and bypassing x402.

**Files:**
- Modify: `lib/skills/registry.ts`
- Modify: `lib/workflow/executor.ts` if it calls registry

**Rule:**

```txt
if skill has enabled endpoint config and priceUsdc > 0:
  call /api/agents/[name] over HTTP with payment payload
else:
  local handler is allowed only for free/internal skills
```

**Important:** For bundle agents, the bundle endpoint is paid. Internal source functions inside the bundle can be local implementation details.

**Verify:**

- Paid skill without payment returns 402.
- Free/internal skill can still run local.

**Commit:**

```bash
git add lib/skills/registry.ts lib/workflow/executor.ts
git commit -m "fix: enforce HTTP x402 boundary for paid skills"
```

---

## Task 5.2: Add payment manifest abstraction for first-request payment

**Objective:** Avoid intentionally triggering `402 -> sign -> retry` for every DAG node.

**Files:**
- Create: `lib/payments/paymentManifest.ts`
- Modify: `lib/skills/registry.ts`
- Modify: `app/api/agents/[name]/route.ts` only if needed

**Behavior:**

```ts
export type PaymentManifestItem = {
  workflowId: string
  nodeId: string
  skillName: string
  resource: string
  amountUsdc: string
  paymentId: string
  validUntil: string
  paymentHeader?: string
}
```

- Build manifest before node execution from `AGENT_ENDPOINTS` pricing.
- Attach payment header on first request when available.
- If endpoint returns 402 due stale terms, refresh and retry once.
- Use idempotency/payment ID to avoid double charge.

**Verify:**

- Normal first request has payment payload.
- Stale/missing payment gets one corrective 402 retry.

**Commit:**

```bash
git add lib/payments/paymentManifest.ts lib/skills/registry.ts app/api/agents/[name]/route.ts
git commit -m "feat: add workflow payment manifest for paid agent calls"
```

---

# Phase 6 — Async Chain and Audit Jobs

## Task 6.1: Add chain jobs table

**Objective:** Move settlement/reputation/validation out of the report hot path.

**Files:**
- Modify: `lib/db/schema.ts`
- Create migration through Drizzle

**Schema:**

```ts
export const chainJobs = pgTable('chain_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }).notNull(),
  kind: text('kind').notNull(),
  status: text('status').default('pending').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  payload: jsonb('payload').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lastError: text('last_error'),
  txHash: text('tx_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
```

**Commands:**

```bash
pnpm db:generate
pnpm db:push
pnpm lint
```

**Commit:**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat: add chain jobs table"
```

---

## Task 6.2: Add chain job enqueuer

**Objective:** Replace direct awaited chain writes with durable job creation.

**Files:**
- Create: `lib/chain/jobs.ts`

**Exports:**

```ts
export async function enqueueWorkflowSettlementJobs(workflowId: string): Promise<void>
export async function enqueueChainJob(args: {
  workflowId: string
  kind: 'erc8183_settle' | 'erc8004_feedback' | 'erc8004_validation' | 'x402_settle'
  idempotencyKey: string
  payload: Record<string, unknown>
}): Promise<void>
```

Use DB unique `idempotencyKey` so retries do not duplicate jobs.

**Verify:**

- Calling enqueuer twice produces one job per idempotency key.

**Commit:**

```bash
git add lib/chain/jobs.ts
git commit -m "feat: add idempotent chain job enqueuer"
```

---

## Task 6.3: Make `publishFinalReport` hot-path only

**Objective:** User-visible report should not wait for ERC-8183/ERC-8004 txs.

**Files:**
- Modify: `lib/ai/finalizeWorkflow.ts`

**Change:**

Replace hot-path awaits:

```ts
await settleWorkflowJob(workflowId, finalMarkdown)
await cacheReputation(workflowId, userId)
```

with:

```ts
await enqueueWorkflowSettlementJobs(workflowId)
```

Then immediately insert final report and mark workflow as user-visible completed. Use status naming consistently, for example:

```txt
completed          = report ready for user
settlement_pending = optional trail state in messages/toolPayload or separate status
```

Do not break existing UI if it expects `completed`.

**Verify:**

- Report writes even when RPC env vars are missing.
- Chain job row is created.
- UI sees completed report without waiting on chain tx.

**Commit:**

```bash
git add lib/ai/finalizeWorkflow.ts
git commit -m "feat: enqueue chain settlement after report publication"
```

---

## Task 6.4: Add chain worker script

**Objective:** Process chain jobs outside request/response lifecycle.

**Files:**
- Create: `scripts/chain-worker.ts`
- Modify: `package.json`

**Script:**

```json
"worker:chain": "tsx scripts/chain-worker.ts"
```

Worker behavior:

```txt
claim pending job
mark running
execute according to kind
store txHash/result
mark completed or failed
retry with backoff if failed
```

Start simple: one process, serial execution. This avoids nonce collisions. Later optimize with per-signer queues.

**Verify:**

```bash
pnpm worker:chain
```

Expected:

```txt
No pending chain jobs
```

or processes one pending job.

**Commit:**

```bash
git add scripts/chain-worker.ts package.json
git commit -m "feat: add async chain job worker"
```

---

# Phase 7 — Worker Durability

## Task 7.1: Stop relying on background Promise in serverless for production mode

**Objective:** Make execution durable beyond a Next.js route lifecycle.

**Files:**
- Create: `scripts/workflow-worker.ts`
- Modify: `package.json`
- Modify: `app/api/workflow/[id]/execute/route.ts`

**Package script:**

```json
"worker:workflow": "tsx scripts/workflow-worker.ts"
```

MVP approach:

- Add simple DB-claimed workflow queue using existing `workflows.status`.
- API route marks status `queued` and returns.
- Worker claims `queued`, marks `running`, calls `executeWorkflowRun(...)`.

Later option:

- Replace DB queue with BullMQ/Redis or pg-boss.

**Verify:**

```bash
pnpm worker:workflow
```

Expected:

```txt
No queued workflows
```

or claims and executes one workflow.

**Commit:**

```bash
git add scripts/workflow-worker.ts package.json app/api/workflow/[id]/execute/route.ts
git commit -m "feat: add durable workflow worker entrypoint"
```

---

# Phase 8 — Progress Stream and UI Semantics

## Task 8.1: Ensure SSE reports node timing and partial status

**Objective:** User sees dynamic progress and understands partial data sources.

**Files:**
- Modify: `app/api/workflow/[id]/stream/route.ts`
- Modify UI component that consumes workflow stream, if applicable

**Stream fields:**

```json
{
  "workflow_status": "running|completed|failed",
  "nodes": [
    {
      "id": "...",
      "status": "completed|failed|partial|running",
      "duration_ms": 1234,
      "partial": true,
      "sources_ok": ["..."],
      "sources_failed": []
    }
  ],
  "chain_audit": "pending|settling|completed|failed"
}
```

**Verify:**

- UI keeps showing report once ready.
- Chain/audit trail can still show pending after report ready.

**Commit:**

```bash
git add app/api/workflow/[id]/stream/route.ts app/
git commit -m "feat: stream workflow timing and partial status"
```

---

# Phase 9 — End-to-End Validation

## Task 9.1: Create a deterministic fast workflow benchmark

**Objective:** Prove the new architecture can finish under 30s without relying on live APIs.

**Files:**
- Modify: `scripts/bench-fast-workflow.ts`

**Benchmark:**

Simulate:

```txt
planner = 1s
3 data bundles = 5s each in parallel
composer = 3s
```

Expected total:

```txt
~9-12s
```

Then simulate:

```txt
one slow optional node = 20s
node timeout = 8s
```

Expected total:

```txt
<= 18s with partial node
```

**Verify:**

```bash
pnpm bench:workflow-fast
```

**Commit:**

```bash
git add scripts/bench-fast-workflow.ts
git commit -m "test: benchmark fast workflow execution budget"
```

---

## Task 9.2: Create live staging smoke test

**Objective:** Test real dynamic sources within the 30s target.

**Files:**
- Create: `scripts/smoke-fast-workflow.ts`
- Modify: `package.json`

**Package script:**

```json
"smoke:workflow-fast": "tsx scripts/smoke-fast-workflow.ts"
```

Test prompt:

```txt
Analyze BTC market using live dynamic data and return a short report.
```

Expected:

```txt
total_ms <= 30000
report exists
nodes <= 5
partial allowed
chain jobs pending/completed async
```

**Verify:**

```bash
pnpm smoke:workflow-fast
```

**Commit:**

```bash
git add scripts/smoke-fast-workflow.ts package.json
git commit -m "test: add live fast workflow smoke test"
```

---

## Task 9.3: Run final quality gates

**Objective:** Ensure plan implementation is shippable.

**Commands:**

```bash
pnpm lint
pnpm build
pnpm bench:workflow-fast
pnpm smoke:workflow-fast
```

**Expected:**

- Lint passes or only documented baseline errors remain.
- Build passes.
- Benchmark under target.
- Smoke test user-visible report <= 30s for fast workflow.

**Commit:**

```bash
git add .
git commit -m "chore: validate 30s dynamic workflow runtime"
```

---

# Implementation Order Summary

```txt
P0 baseline
P1 runtime config + timing
P2 dynamic data bundle agents
P3 compiled planner inputs
P4 parallel executor + timeouts
P5 paid HTTP/x402 boundary + payment manifest
P6 async chain jobs
P7 durable worker
P8 progress stream semantics
P9 benchmark + smoke validation
```

---

# Risk Register

## Risk 1: x402 on Arc is not fully supported by official facilitator

Mitigation:

- Keep x402 boundary and payment manifest abstraction.
- Use self-host Arc-compatible facilitator if official support is missing.
- Do not claim hosted Circle facilitator compliance until verified.

## Risk 2: Live external APIs exceed 30s

Mitigation:

- Data bundle uses `Promise.allSettled`.
- Fast mode defers slow sources.
- Partial report is valid output at 30s.

## Risk 3: Planner still emits too many nodes

Mitigation:

- Enforce schema validation after planner.
- If nodes > max or depth > max, auto-collapse to bundle plan or reject with deep-mode estimate.

## Risk 4: Async chain jobs fail silently

Mitigation:

- Persist every job in `chain_jobs`.
- Show status in UI stream.
- Retry with backoff and last error.

## Risk 5: Nonce collisions in chain worker

Mitigation:

- Start with single serial chain worker.
- Later shard by signer or add nonce locks.

---

# Definition of Done

This plan is complete when:

```txt
1. Fast dynamic-data workflow uses <= 5 nodes.
2. Planner outputs executable inputs; no LLM per node.
3. Independent nodes execute in parallel.
4. Slow sources return partial/deferred status.
5. Report is visible within 30s in staging smoke test.
6. Paid agents keep HTTP/x402 boundary.
7. Chain settlement/reputation/validation happen through async jobs.
8. UI distinguishes report-ready from audit-settling.
9. pnpm lint and pnpm build pass or baseline issues are documented.
```
