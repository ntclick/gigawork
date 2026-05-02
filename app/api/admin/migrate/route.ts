import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/client'

// One-shot migration endpoint. Local dev only — guard with a header so it
// never runs in prod. Re-running is safe (everything is `if not exists`).

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'disabled in production' }, { status: 403 })
  }
  const guard = req.headers.get('x-migrate-token') ?? ''
  if (guard !== (process.env.MIGRATE_TOKEN ?? 'dev-migrate')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const steps: string[] = []

  await db.execute(sql`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      wallet text not null unique,
      credits integer not null default 0,
      created_at timestamptz not null default now()
    )
  `)
  steps.push('users')

  await db.execute(sql`
    create table if not exists credit_ledger (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      delta integer not null,
      reason text not null,
      workflow_id uuid references workflows(id) on delete set null,
      tx_hash text,
      created_at timestamptz not null default now()
    )
  `)
  steps.push('credit_ledger')

  await db.execute(sql`
    create index if not exists credit_ledger_user_idx on credit_ledger(user_id, created_at desc)
  `)
  steps.push('index')

  try {
    await db.execute(sql`alter table users enable row level security`)
    await db.execute(sql`alter table credit_ledger enable row level security`)
    steps.push('rls')
  } catch {
    /* idempotent skip */
  }

  try {
    await db.execute(sql`
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
    `)
    steps.push('workflows.user_id_fk')
  } catch {
    /* idempotent skip */
  }

  // ERC-8004 identity columns
  await db.execute(sql`alter table users add column if not exists identity_token_id text`)
  await db.execute(sql`alter table users add column if not exists identity_tx_hash text`)
  await db.execute(sql`alter table users add column if not exists identity_minted_at timestamptz`)
  steps.push('identity_columns')

  // ERC-8004 provider agent columns
  await db.execute(sql`alter table skills add column if not exists agent_token_id text`)
  await db.execute(sql`alter table skills add column if not exists agent_tx_hash text`)
  await db.execute(sql`alter table skills add column if not exists agent_minted_at timestamptz`)
  steps.push('skills_agent_columns')

  return NextResponse.json({ ok: true, applied: steps })
}
