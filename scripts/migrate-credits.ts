import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL missing')

const sql = postgres(url, { prepare: false })

async function main() {
  await sql`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      wallet text not null unique,
      credits integer not null default 0,
      created_at timestamptz not null default now()
    )
  `
  console.log('✓ users table')

  await sql`
    create table if not exists credit_ledger (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      delta integer not null,
      reason text not null,
      workflow_id uuid references workflows(id) on delete set null,
      tx_hash text,
      created_at timestamptz not null default now()
    )
  `
  console.log('✓ credit_ledger table')

  await sql`create index if not exists credit_ledger_user_idx on credit_ledger(user_id, created_at desc)`
  console.log('✓ index')

  try {
    await sql`alter table users enable row level security`
    await sql`alter table credit_ledger enable row level security`
    console.log('✓ RLS enabled')
  } catch (e) {
    console.warn('RLS skip:', e instanceof Error ? e.message : e)
  }

  try {
    await sql`
      do $$ begin
        if not exists (
          select 1 from information_schema.table_constraints
          where constraint_name = 'workflows_user_id_fkey'
        ) then
          alter table workflows
            add constraint workflows_user_id_fkey
            foreign key (user_id) references users(id) on delete set null;
        end if;
      end $$
    `
    console.log('✓ workflows.user_id FK')
  } catch (e) {
    console.warn('FK skip:', e instanceof Error ? e.message : e)
  }

  await sql.end()
  console.log('done')
}

main().catch(async (e) => {
  console.error('migration failed:', e)
  await sql.end()
  process.exit(1)
})
