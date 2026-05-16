import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
config({ path: '.env.local' })

const sql = postgres(process.env.DATABASE_URL, { prepare: false })

const users = await sql`
  SELECT id, wallet, privy_id, credits, created_at
  FROM users
  ORDER BY created_at DESC
  LIMIT 20
`
console.log('=== users ===')
for (const u of users) {
  console.log(`${u.id} | wallet=${u.wallet} | privy=${u.privy_id ?? '(null)'} | cr=${u.credits}`)
}

const wfs = await sql`
  SELECT w.id, w.status, w.created_at, u.wallet as owner_wallet, u.privy_id as owner_privy
  FROM workflows w
  LEFT JOIN users u ON u.id = w.user_id
  ORDER BY w.created_at DESC
  LIMIT 20
`
console.log('\n=== recent workflows ===')
for (const w of wfs) {
  console.log(`${w.id} | ${w.status} | owner=${w.owner_wallet ?? '(orphan)'} | privy=${w.owner_privy ?? '(null)'}`)
}

await sql.end()
