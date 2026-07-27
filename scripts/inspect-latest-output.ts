import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env' })

async function main() {
  const { eq, desc } = await import('drizzle-orm')
  const { db } = await import('@/lib/db/client')
  const { messages, nodes, workflows } = await import('@/lib/db/schema')
  console.log('🔍 Inspecting latest completed workflow output...')

  const [wf] = await db
    .select()
    .from(workflows)
    .orderBy(desc(workflows.createdAt))
    .limit(1)

  if (!wf) {
    console.log('No completed workflow found.')
    return
  }

  console.log(`\n📌 Workflow ID: ${wf.id}`)
  console.log(`Prompt: ${wf.prompt}`)
  console.log(`ERC8183 Job ID: ${wf.erc8183JobId}`)
  console.log(`ERC8183 Fund Tx: ${wf.erc8183FundTx}`)

  console.log('\n--- 🧩 Node Outputs ---')
  const nodeRows = await db.select().from(nodes).where(eq(nodes.workflowId, wf.id))
  for (const n of nodeRows) {
    console.log(`\nNode: [${n.label}] (status: ${n.status})`)
    console.log(`Output:`, JSON.stringify(n.output, null, 2))
  }

  console.log('\n--- 📝 Final Report Messages ---')
  const msgRows = await db.select().from(messages).where(eq(messages.workflowId, wf.id))
  for (const m of msgRows) {
    if (m.role === 'brain' && m.toolName !== 'planWorkflow') {
      console.log(`\n[${m.role}] (tool: ${m.toolName ?? 'none'}):`)
      console.log(m.content)
      if (m.toolPayload) {
        console.log(`Payload:`, JSON.stringify(m.toolPayload, null, 2))
      }
    }
  }
}

main().catch(console.error)
