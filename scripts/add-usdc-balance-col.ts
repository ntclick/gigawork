import { config as loadEnv } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')

loadEnv({ path: resolve(ROOT, '.env.local'), override: true })
loadEnv({ path: resolve(ROOT, '.env') })

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    'aws-1-ap-south-1.pooler.supabase.com',
    '3.111.225.200'
  )
}

async function addCol() {
  const { db } = await import('../lib/db/client')
  const { sql } = await import('drizzle-orm')

  console.log('Adding usdc_balance column to users table if not exists...')
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS usdc_balance numeric DEFAULT '10.00' NOT NULL`)
  console.log('Successfully added usdc_balance column!')
}

addCol().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
