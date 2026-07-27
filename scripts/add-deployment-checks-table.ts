/**
 * add-deployment-checks-table — create deployment_checks table if not exists.
 * Idempotent (IF NOT EXISTS).
 *
 * Usage: tsx scripts/add-deployment-checks-table.ts
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

const url = DATABASE_URL.replace('aws-1-ap-south-1.pooler.supabase.com', '3.109.171.244')
const sql = postgres(url)

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS deployment_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      verdict TEXT,
      confidence INTEGER,
      output JSONB,
      note TEXT,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS deployment_checks_deployment_id_idx ON deployment_checks(deployment_id);
  `)
  console.log('✅ deployment_checks table and index verified/created')

  await sql.end()
  console.log('Done!')
}

main().catch((e) => {
  console.error('Migration failed:', e)
  process.exit(1)
})
