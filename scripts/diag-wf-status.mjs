import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
const sql = postgres(process.env.DATABASE_URL, { prepare: false })
const r = await sql`
  SELECT id, status, erc8183_job_id, erc8183_fund_tx, erc8183_submit_tx, erc8183_complete_tx, created_at
  FROM workflows
  WHERE erc8183_job_id = '17624'
  ORDER BY created_at DESC LIMIT 1
`
console.log(r[0] ?? 'no workflow with job 17624')
await sql.end()
