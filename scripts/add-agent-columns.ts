import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'

/**
 * Adds the ERC-8004 mint metadata columns to the `skills` table.
 * Idempotent — uses IF NOT EXISTS so re-running is safe.
 */
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL missing')

const sql = postgres(url, { prepare: false })

async function main() {
  console.log('Adding ERC-8004 columns to skills...')
  await sql.unsafe(`
    ALTER TABLE skills
      ADD COLUMN IF NOT EXISTS agent_token_id  TEXT,
      ADD COLUMN IF NOT EXISTS agent_tx_hash   TEXT,
      ADD COLUMN IF NOT EXISTS agent_minted_at TIMESTAMP WITH TIME ZONE;
  `)
  console.log('✓ Done')
  await sql.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
