import { config as loadEnv } from 'dotenv'
import type { UIMessage } from 'ai'
loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env' })

// DNS Bypass
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    'aws-1-ap-south-1.pooler.supabase.com',
    '3.111.225.200'
  )
}

const ADMIN_WALLET = '0xafe6dd950dc2cf561e8daba1725e0e6840f70549'

async function main() {
  console.log('🧪 Starting live fast workflow E2E smoke test...')

  const { eq } = await import('drizzle-orm')
  const { db } = await import('../lib/db/client')
  const { messages, nodes, users, workflows } = await import('../lib/db/schema')
  const { streamBrain } = await import('../lib/ai/brain')

  // Find or seed admin user
  const [u] = await db.select().from(users).where(eq(users.wallet, ADMIN_WALLET)).limit(1)
  if (!u) {
    console.error('Admin user not found. Please run scripts/test-workflow.ts once first.')
    process.exit(1)
  }

  const prompt = 'Analyze BTC market using live dynamic data and return a short report.'
  console.log(`Prompt: "${prompt}"`)

  // Create workflow
  const [wf] = await db.insert(workflows).values({
    prompt,
    userId: u.id,
    status: 'planning',
  }).returning()

  console.log(`Created smoke workflow: ${wf.id}`)
  await db.insert(messages).values({ workflowId: wf.id, role: 'user', content: prompt })

  // 1. Plan workflow
  console.log('\n① Running planner (Hermes/Kimi stream)...')
  const planStart = Date.now()
  const uiMessages: UIMessage[] = [
    { id: 'seed', role: 'user', parts: [{ type: 'text', text: prompt }] },
  ]
  const result = await streamBrain({
    workflowId: wf.id,
    userId: u.id,
    uiMessages,
  })

  // Drain the stream to let planning complete
  let chunks = 0
  for await (const part of result.fullStream) {
    chunks++
    if (part.type === 'tool-call') {
      console.log(`   → Planned tool: ${part.toolName}`)
    }
  }
  console.log(`✓ Planning finished in ${((Date.now() - planStart) / 1000).toFixed(2)}s (${chunks} chunks)`)

  // 2. Execute workflow
  console.log('\n② Waiting for parallel DAG executor worker...')
  const execStart = Date.now()

  // Set to queued first to match actual frontend trigger flow
  await db.update(workflows).set({ status: 'queued' }).where(eq(workflows.id, wf.id))

  // Poll DB until status is completed or failed
  let finalWf = null
  while (true) {
    await new Promise((r) => setTimeout(r, 1000))
    finalWf = await db.query.workflows.findFirst({ where: eq(workflows.id, wf.id) })
    if (finalWf && (finalWf.status === 'completed' || finalWf.status === 'failed')) {
      break
    }
  }
  const execElapsed = Date.now() - execStart
  console.log(`✓ Execution finished in ${(execElapsed / 1000).toFixed(2)}s`)
  const nodeRows = await db.query.nodes.findMany({ where: eq(nodes.workflowId, wf.id) })
  const msgRows = await db.query.messages.findMany({ where: eq(messages.workflowId, wf.id) })

  console.log('\n📊 Node Results:')
  for (const n of nodeRows) {
    const durationMs = n.completedAt && n.startedAt
      ? n.completedAt.getTime() - n.startedAt.getTime()
      : 0
    console.log(`- ${n.label}: status=${n.status} (${(durationMs / 1000).toFixed(2)}s)`)
    if (n.status === 'failed') {
      console.log(`  Error: ${JSON.stringify(n.output)}`)
    }
  }

  // Find final report message
  const reportMsg = msgRows.find((m) => m.role === 'brain' && m.toolName !== 'stream_error' && m.content && !m.content.startsWith('▸ Planning'))
  const reportExcerpt = reportMsg?.content ? reportMsg.content.slice(0, 300) + '...' : '(no report generated)'

  console.log('\n📝 Final Report Excerpt:')
  console.log(reportExcerpt)

  console.log('\n⚡ E2E Verification Metrics:')
  console.log(`- Total Nodes: ${nodeRows.length} (Expected <= 5)`)
  console.log(`- Final Status: ${finalWf?.status} (Expected "completed")`)
  
  if (execElapsed <= 30000) {
    console.log('🟢 SUCCESS: Execution completed under 30s target!')
  } else {
    console.log(`⚠️ WARNING: Execution took ${(execElapsed / 1000).toFixed(2)}s (Target <= 30s)`)
  }

  if (nodeRows.length <= 5) {
    console.log('🟢 SUCCESS: Planned graph fits within fast-mode size budget (<= 5 nodes)!')
  } else {
    console.log(`⚠️ WARNING: Planned graph has ${nodeRows.length} nodes (Expected <= 5)`)
  }

  process.exit(0)
}

main().catch((e) => {
  console.error('Smoke test crashed:', e)
  process.exit(1)
})
