import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
import postgres from 'postgres'

// Use direct connection (not pooler) for DDL
const rawUrl = process.env.DATABASE_URL!

const sql = postgres(rawUrl, { prepare: false })

async function run() {
  // Only target public.users — check what's actually there
  const cols = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'users'
    ORDER BY ordinal_position
  `
  console.log('Current public.users columns:', cols.map((c: any) => c.column_name).join(', '))

  const missingCols = [
    'prefunded_at timestamptz',
    'notify_email text',
    'email_api_key text',
    'email_from text',
    'telegram_bot_token text',
    'telegram_chat_id text',
  ]

  for (const col of missingCols) {
    const name = col.split(' ')[0]
    try {
      await sql.unsafe(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ${col}`)
      console.log(`✅ Added: ${name}`)
    } catch (e: any) {
      console.log(`⚠️  ${name}: ${e.message || 'already exists or error'}`)
    }
  }

  // Also check workflows for missing cols
  const wfCols = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'workflows'
    ORDER BY ordinal_position
  `
  console.log('\nCurrent public.workflows columns:', wfCols.map((c: any) => c.column_name).join(', '))

  const missingWfCols = [
    'erc8183_set_budget_tx text',
    'erc8183_approve_tx text',
  ]
  for (const col of missingWfCols) {
    const name = col.split(' ')[0]
    try {
      await sql.unsafe(`ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS ${col}`)
      console.log(`✅ Added: workflows.${name}`)
    } catch (e: any) {
      console.log(`⚠️  workflows.${name}: ${e.message}`)
    }
  }

  await sql.end()
  console.log('\n✅ Done!')
}

run().catch(e => { console.error(e); process.exit(1) })
