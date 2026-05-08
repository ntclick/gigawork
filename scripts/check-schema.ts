import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!)

async function run() {
  // Check which columns exist in users table
  const userCols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'users' 
    ORDER BY ordinal_position
  `
  console.log('\n=== users table columns ===')
  for (const c of userCols) console.log(` - ${c.column_name} (${c.data_type})`)

  // Check workflows columns
  const wfCols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'workflows' 
    ORDER BY ordinal_position
  `
  console.log('\n=== workflows table columns ===')
  for (const c of wfCols) console.log(` - ${c.column_name} (${c.data_type})`)

  // Count rows
  const [{ count: uCount }] = await sql`SELECT count(*) FROM users`
  const [{ count: wCount }] = await sql`SELECT count(*) FROM workflows`
  console.log(`\n=== Row counts ===`)
  console.log(` users: ${uCount}`)
  console.log(` workflows: ${wCount}`)

  await sql.end()
}

run().catch(console.error)
