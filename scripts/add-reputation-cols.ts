/**
 * add-reputation-cols — add reputation_score column to users + skills.
 * Idempotent (IF NOT EXISTS).
 *
 * Usage: tsx scripts/add-reputation-cols.ts
 */
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env', override: true })
import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set')
  process.exit(1)
}

const sql = postgres(DATABASE_URL)

async function main() {
  await sql.unsafe(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS reputation_score integer NOT NULL DEFAULT 0`
  )
  console.log('✅ users.reputation_score added')

  await sql.unsafe(
    `ALTER TABLE skills ADD COLUMN IF NOT EXISTS reputation_score integer NOT NULL DEFAULT 0`
  )
  console.log('✅ skills.reputation_score added')

  await sql.end()
  console.log('Done!')
}

main().catch((e) => {
  console.error('Migration failed:', e)
  process.exit(1)
})
