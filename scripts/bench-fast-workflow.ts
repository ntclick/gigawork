import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env' })

const ADMIN_WALLET = '0xafe6dd950dc2cf561e8daba1725e0e6840f70549'

async function main() {
  console.log('🧪 Starting fast workflow parallel benchmark...')

  // Lazy-import after environment is loaded
  const { eq } = await import('drizzle-orm')
  const { db } = await import('../lib/db/client')
  const { workflows, nodes, users, messages } = await import('../lib/db/schema')
  const { executeWorkflowRun } = await import('../lib/workflow/executor')

  // Get admin user
  const [user] = await db.select().from(users).where(eq(users.wallet, ADMIN_WALLET)).limit(1)
  if (!user) {
    console.error('User not found. Run scripts/test-workflow.ts once to seed admin user.')
    process.exit(1)
  }

  // Find the required skills
  const skillRows = await db.query.skills.findMany()
  const byName = new Map(skillRows.map((s) => [s.name, s]))

  const marketSkill = byName.get('market-data-bundle')
  const socialSkill = byName.get('social-lite-bundle')
  const composerSkill = byName.get('report-composer-fast')

  if (!marketSkill || !socialSkill || !composerSkill) {
    console.error('Missing registered bundle skills in DB. Run seed-skills.ts or seed DB.')
    process.exit(1)
  }

  // Create workflow
  const [wf] = await db.insert(workflows).values({
    prompt: 'Benchmark token SOL sentiment and price details, then compose fast report.',
    userId: user.id,
    status: 'running',
  }).returning()

  console.log(`Created benchmark workflow: ${wf.id}`)

  // Create nodes with inputs
  const plannedNodes = [
    {
      id: 'market_node',
      label: 'Scan SOL Market Data',
      skillId: marketSkill.id,
      dependsOn: [],
      input: {
        token_address: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        symbol: 'SOL/USDT',
      },
    },
    {
      id: 'social_node',
      label: 'Scan SOL Social Sentiment',
      skillId: socialSkill.id,
      dependsOn: [],
      input: {
        topic: 'Solana',
        window_hours: 24,
      },
    },
    {
      id: 'composer_node',
      label: 'Fast Report Synthesis',
      skillId: composerSkill.id,
      dependsOn: ['market_node', 'social_node'],
      input: {
        tone: 'casual',
        format: 'markdown',
      },
    },
  ]

  const dbNodes = await db.insert(nodes).values(
    plannedNodes.map((pn) => ({
      workflowId: wf.id,
      kind: 'skill_call',
      label: pn.label,
      skillId: pn.skillId,
      status: 'pending',
      dependsOn: pn.dependsOn,
      input: pn.input,
    }))
  ).returning()

  // Build the planWorkflow message so mapping works correctly
  const planOut = {
    nodes: dbNodes.map((n, i) => ({
      node_id: n.id,
      plan_id: plannedNodes[i].id,
      label: n.label,
      skill_name: skillRows.find((s) => s.id === n.skillId)?.name || '',
      depends_on: n.dependsOn,
      input: n.input,
    })),
  }

  await db.insert(messages).values({
    workflowId: wf.id,
    role: 'system',
    toolName: 'planWorkflow',
    toolPayload: {
      input: {
        nodes: plannedNodes.map((pn) => ({
          id: pn.id,
          label: pn.label,
          skill_name: skillRows.find((s) => s.id === pn.skillId)?.name || '',
          depends_on: pn.dependsOn,
          input: pn.input,
        })),
      },
      output: planOut,
    },
    content: null,
  })

  console.log('Running executor...')
  const started = Date.now()

  await executeWorkflowRun({ workflowId: wf.id, userId: user.id })

  const elapsed = Date.now() - started
  console.log(`\n⏱️ Total Execution Time: ${(elapsed / 1000).toFixed(2)}s`)

  // Verify DB state
  const completedNodes = await db.select({
    id: nodes.id,
    label: nodes.label,
    status: nodes.status,
    startedAt: nodes.startedAt,
    completedAt: nodes.completedAt,
    output: nodes.output,
  }).from(nodes).where(eq(nodes.workflowId, wf.id))

  console.log('\n📊 Executed Nodes Status:')
  for (const cn of completedNodes) {
    const durationMs = cn.completedAt && cn.startedAt
      ? cn.completedAt.getTime() - cn.startedAt.getTime()
      : 0
    const durationStr = `${(durationMs / 1000).toFixed(2)}s`
    console.log(`- ${cn.label}: ${cn.status} (${durationStr})`)
    if (cn.status === 'failed') {
      console.log(`  Error: ${JSON.stringify(cn.output)}`)
    }
  }

  const sumSequentialTime = completedNodes.reduce((acc, cn) => {
    if (cn.completedAt && cn.startedAt) {
      return acc + (cn.completedAt.getTime() - cn.startedAt.getTime())
    }
    return acc
  }, 0)

  console.log(`\n📈 Parallel Performance Analysis:`)
  console.log(`- Sum of sequential node times: ${(sumSequentialTime / 1000).toFixed(2)}s`)
  console.log(`- Theoretical sequential execution: ${(sumSequentialTime / 1000).toFixed(2)}s`)
  console.log(`- Actual parallel execution time: ${(elapsed / 1000).toFixed(2)}s`)
  
  const savedMs = sumSequentialTime - elapsed
  if (savedMs > 0) {
    console.log(`🟢 Saved ${(savedMs / 1000).toFixed(2)}s due to concurrent scan execution!`)
  } else {
    console.log(`⚪ Parallel execution time is comparable to sequential (likely minimal latency or fast cache hits).`)
  }

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
