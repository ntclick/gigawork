import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
config({ path: '.env.local' })

const sql = postgres(process.env.DATABASE_URL, { prepare: false })

await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS privy_id TEXT`
// Partial unique index: only enforce uniqueness when privy_id is set, so
// legacy rows with NULL privy_id don't all collide.
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS users_privy_id_unique
  ON users (privy_id)
  WHERE privy_id IS NOT NULL
`
const r = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='users' AND column_name='privy_id'
`
console.log('privy_id column:', r.length > 0 ? '✅ exists' : '❌ missing')
await sql.end()
