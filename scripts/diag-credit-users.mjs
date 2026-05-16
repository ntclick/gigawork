import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
const sql = postgres(process.env.DATABASE_URL, { prepare: false })

const r = await sql`
  SELECT u.id, u.wallet, u.privy_id, u.credits, u.identity_token_id,
    (SELECT COUNT(*) FROM credit_ledger WHERE user_id = u.id)::int AS ledger_n,
    (SELECT COUNT(*) FROM workflows WHERE user_id = u.id)::int AS wf_n,
    u.created_at
  FROM users u
  WHERE u.credits > 0
  ORDER BY u.created_at DESC
  LIMIT 20
`
console.log('=== users with credits ===')
for (const u of r) {
  console.log(`${u.wallet} | privy=${u.privy_id ?? '(null)'} | cr=${u.credits} | nft=${u.identity_token_id ?? '(none)'} | ledger=${u.ledger_n} | wf=${u.wf_n}`)
}
await sql.end()
