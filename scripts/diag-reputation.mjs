import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
const sql = postgres(process.env.DATABASE_URL, { prepare: false })

// Most recent workflow with settled state
const wf = await sql`
  SELECT id, status, erc8183_job_id, erc8183_complete_tx, user_id, created_at
  FROM workflows
  WHERE erc8183_complete_tx IS NOT NULL
  ORDER BY created_at DESC LIMIT 3
`
for (const w of wf) {
  console.log('--- workflow', w.id, '---')
  console.log('  job:', w.erc8183_job_id, 'status:', w.status, 'complete tx:', w.erc8183_complete_tx)
  const msgs = await sql`
    SELECT tool_name, tool_payload FROM messages
    WHERE workflow_id = ${w.id} AND tool_name = 'reputationUpdate'
  `
  if (msgs.length === 0) {
    console.log('  reputation: NO reputationUpdate message recorded')
  } else {
    for (const m of msgs) console.log('  reputation:', JSON.stringify(m.tool_payload))
  }
  const u = await sql`SELECT identity_token_id, reputation_score FROM users WHERE id = ${w.user_id}`
  console.log('  user.identityTokenId:', u[0]?.identity_token_id, '| score:', u[0]?.reputation_score)
}
await sql.end()
