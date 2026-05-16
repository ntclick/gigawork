import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
const sql = postgres(process.env.DATABASE_URL, { prepare: false })

// Workflows stuck in 'funding' that have all 4 escrow tx hashes —
// the confirm endpoint had a bug where it bailed early once track
// wrote fundTx, so status never flipped to 'planning'. Promote them
// now so Hermes can pick them up.
const stuck = await sql`
  SELECT id, erc8183_job_id, status FROM workflows
  WHERE status = 'funding'
    AND erc8183_create_tx IS NOT NULL
    AND erc8183_set_budget_tx IS NOT NULL
    AND erc8183_approve_tx IS NOT NULL
    AND erc8183_fund_tx IS NOT NULL
  ORDER BY created_at DESC
`
console.log(`Found ${stuck.length} workflows stuck at status='funding' with all 4 tx`)
for (const w of stuck) {
  await sql`UPDATE workflows SET status='planning' WHERE id = ${w.id}`
  console.log(`  ${w.id} (job #${w.erc8183_job_id}) → planning`)
}
await sql.end()
