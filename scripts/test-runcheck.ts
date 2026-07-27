import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env' })

async function main() {
  console.log('🧪 Testing runCheck deployment thesis pipeline...')

  const { db } = await import('../lib/db/client')
  const { deployments, workflows, users } = await import('../lib/db/schema')
  const { runCheck } = await import('../lib/deployments/runCheck')
  const { eq } = await import('drizzle-orm')

  const [u] = await db.select().from(users).limit(1)
  if (!u) {
    console.error('No user found in DB')
    process.exit(1)
  }

  // Create test workflow & deployment
  const [wf] = await db.insert(workflows).values({
    prompt: 'Track BTC Trading Signals RSI MACD EMA',
    userId: u.id,
    status: 'planning',
  }).returning()

  const [dep] = await db.insert(deployments).values({
    workflowId: wf.id,
    userId: u.id,
    cronExpression: '*/30 * * * *',
    status: 'active',
  }).returning()

  console.log(`Created test deployment ${dep.id} for workflow ${wf.id}`)

  console.log('Running runCheck(dep.id)...')
  const result = await runCheck(dep.id)

  console.log('✅ Check completed successfully!')
  console.log('Verdict:', result.thesis.verdict)
  console.log('Confidence:', result.thesis.confidence + '%')
  console.log('Supporting reasons:', result.thesis.supporting)
  console.log('Counterpoint:', result.thesis.counterpoint)
  console.log('Invalidation:', result.thesis.invalidation)
  console.log('Data Source:', result.thesis.dataSource)
  console.log('LLM Note:', result.check.note)

  process.exit(0)
}

main().catch((err) => {
  console.error('runCheck test failed:', err)
  process.exit(1)
})
