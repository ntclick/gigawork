/**
 * add-notify-cols.ts — add user-level notification preferences.
 *
 *   - notify_email      → where to push email-sender results
 *   - telegram_chat_id  → where to push telegram-sender results
 *
 * Idempotent (IF NOT EXISTS). Run via `pnpm db:add-notify-cols`.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { prepare: false })

async function main() {
  console.log('① Adding notify_email column…')
  await sql.unsafe(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS notify_email text
  `)
  console.log('   ✓')

  console.log('② Adding telegram_chat_id column…')
  await sql.unsafe(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS telegram_chat_id text
  `)
  console.log('   ✓')

  console.log('③ Adding telegram_bot_token column…')
  await sql.unsafe(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS telegram_bot_token text
  `)
  console.log('   ✓')

  console.log('④ Adding email_api_key column…')
  await sql.unsafe(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_api_key text
  `)
  console.log('   ✓')

  console.log('⑤ Adding email_from column…')
  await sql.unsafe(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_from text
  `)
  console.log('   ✓')

  await sql.end()
  console.log('\n✅ Profile columns ready.')
}

main().catch((e) => { console.error(e); process.exit(1) })
