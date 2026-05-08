import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
import postgres from 'postgres'

// Use direct DB URL — pooler may have DNS issues from local
// Supabase direct: postgresql://postgres.<project>:<password>@db.<project>.supabase.co:5432/postgres
const poolerUrl = process.env.DATABASE_URL!
// Convert pooler URL to direct URL
const directUrl = poolerUrl
  .replace('aws-1-ap-south-1.pooler.supabase.com:6543', 'db.yxnmthhkvmjuuapsbchw.supabase.co:5432')
  .replace('postgres.yxnmthhkvmjuuapsbchw', 'postgres')

console.log('Connecting to:', directUrl.replace(/:([^@]+)@/, ':***@'))

const sql = postgres(directUrl, { prepare: false, connect_timeout: 15 })

async function run() {
  const devWallet = process.env.DEV_WALLET!.toLowerCase()
  
  // Check admin wallet user record
  const users = await sql`
    SELECT id, wallet, credits, identity_token_id, identity_minted_at, prefunded_at
    FROM public.users
    WHERE wallet = ${devWallet}
    LIMIT 1
  `
  console.log('\n=== Admin wallet user ===')
  console.log(users[0] ?? 'NOT FOUND in DB')

  // Check latest workflows
  const wfs = await sql`
    SELECT id, status, prompt, created_at
    FROM public.workflows
    ORDER BY created_at DESC
    LIMIT 5
  `
  console.log('\n=== Latest 5 workflows ===')
  for (const w of wfs) console.log(` [${w.status}] ${w.id} — "${w.prompt?.slice(0,60)}"`)

  // Messages for most recent workflow
  if (wfs[0]) {
    const msgs = await sql`
      SELECT role, tool_name, content
      FROM public.messages
      WHERE workflow_id = ${wfs[0].id}
      ORDER BY created_at ASC
    `
    console.log(`\n=== Messages in latest workflow ===`)
    for (const m of msgs) {
      console.log(` [${m.role}] ${m.tool_name ?? ''} ${(m.content ?? '').slice(0, 120)}`)
    }
  }

  await sql.end()
}

run().catch(e => { console.error('Error:', e.message); process.exit(1) })
