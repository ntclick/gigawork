/**
 * /api/admin/migrate — POST X-Migrate-Token to apply schema changes to the
 * Vercel-connected DB. Idempotent (every statement is IF NOT EXISTS or
 * ALTER ... ADD COLUMN IF NOT EXISTS) so running this multiple times is
 * safe. Removed the NODE_ENV check — the migrate token header is the
 * actual gate; production needs to migrate too.
 */
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/client'

const MIGRATIONS: Array<[label: string, sqlText: string]> = [
  // ── Bootstrap tables ─────────────────────────────────────────
  [
    'users.create',
    `create table if not exists users (
       id uuid primary key default gen_random_uuid(),
       wallet text not null unique,
       credits integer not null default 0,
       created_at timestamptz not null default now()
     )`,
  ],
  [
    'workflows.create',
    `create table if not exists workflows (
       id uuid primary key default gen_random_uuid(),
       user_id uuid references users(id) on delete set null,
       prompt text not null,
       status text not null default 'planning',
       created_at timestamptz not null default now()
     )`,
  ],
  [
    'credit_ledger.create',
    `create table if not exists credit_ledger (
       id uuid primary key default gen_random_uuid(),
       user_id uuid not null references users(id) on delete cascade,
       delta integer not null,
       reason text not null,
       workflow_id uuid references workflows(id) on delete set null,
       tx_hash text,
       created_at timestamptz not null default now()
     )`,
  ],
  [
    'skills.create',
    `create table if not exists skills (
       id uuid primary key default gen_random_uuid(),
       name text not null unique,
       manifest jsonb not null,
       endpoint text not null
     )`,
  ],
  [
    'nodes.create',
    `create table if not exists nodes (
       id uuid primary key default gen_random_uuid(),
       workflow_id uuid not null references workflows(id) on delete cascade,
       kind text not null,
       label text not null,
       status text not null default 'pending',
       created_at timestamptz not null default now()
     )`,
  ],
  [
    'messages.create',
    `create table if not exists messages (
       id uuid primary key default gen_random_uuid(),
       workflow_id uuid not null references workflows(id) on delete cascade,
       role text not null,
       created_at timestamptz not null default now()
     )`,
  ],
  [
    'nanopayment_events.create',
    `create table if not exists nanopayment_events (
       id uuid primary key default gen_random_uuid(),
       workflow_id uuid not null references workflows(id) on delete cascade,
       step_id text,
       skill_name text not null,
       amount_usdc text not null,
       buyer_address text not null,
       status text not null default 'queued',
       tx_hash text,
       created_at timestamptz not null default now()
     )`,
  ],
  [
    'workflow_events.create',
    `create table if not exists workflow_events (
       id uuid primary key default gen_random_uuid(),
       workflow_id uuid not null references workflows(id) on delete cascade,
       node_id uuid references nodes(id) on delete set null,
       skill_name text,
       agent_id text,
       type text not null,
       status text,
       message text,
       payload jsonb not null default '{}'::jsonb,
       quote_id text,
       payment_id text,
       tx_hash text,
       created_at timestamptz not null default now()
     )`,
  ],
  [
    'agents.create',
    `create table if not exists agents (
       id uuid primary key default gen_random_uuid(),
       onchain_id bigint unique,
       owner_address text not null,
       agent_type text,
       name text,
       description text,
       capabilities text[],
       wallet_id text,
       wallet_address text,
       metadata_uri text,
       reputation_score numeric default '0',
       is_active boolean default true,
       created_at timestamptz default now()
     )`,
  ],
  [
    'jobs.create',
    `create table if not exists jobs (
       id uuid primary key default gen_random_uuid(),
       onchain_job_id bigint unique,
       client_agent_id uuid references agents(id) on delete cascade,
       provider_agent_id uuid references agents(id) on delete cascade,
       status text,
       budget_usdc numeric,
       description text,
       deliverable_hash text,
       created_at timestamptz default now(),
       funded_at timestamptz,
       completed_at timestamptz
     )`,
  ],
  [
    'negotiations.create',
    `create table if not exists negotiations (
       id uuid primary key default gen_random_uuid(),
       job_id uuid references jobs(id) on delete cascade,
       agent_id uuid references agents(id) on delete cascade,
       role text,
       message text,
       price_offer numeric,
       created_at timestamptz default now()
     )`,
  ],
  [
    'nanopayments.create',
    `create table if not exists nanopayments (
       id uuid primary key default gen_random_uuid(),
       from_agent_id uuid references agents(id) on delete cascade,
       to_agent_id uuid references agents(id) on delete cascade,
       amount_usdc numeric,
       purpose text,
       status text,
       "authorization" jsonb,
       created_at timestamptz default now()
     )`,
  ],

  // ── credit_ledger.tx_hash unique (top-up replay guard) ───────
  [
    'credit_ledger.tx_hash_unique',
    `do $$ begin
       if not exists (
         select 1 from pg_constraint where conname = 'credit_ledger_tx_hash_unique'
       ) then
         alter table credit_ledger add constraint credit_ledger_tx_hash_unique unique (tx_hash);
       end if;
     end $$`,
  ],

  // ── users — auth + profile flexibility ───────────────────────
  ['users.identity_token_id', `alter table users add column if not exists identity_token_id text`],
  ['users.identity_tx_hash', `alter table users add column if not exists identity_tx_hash text`],
  ['users.identity_minted_at', `alter table users add column if not exists identity_minted_at timestamptz`],
  ['users.prefunded_at', `alter table users add column if not exists prefunded_at timestamptz`],
  ['users.notify_email', `alter table users add column if not exists notify_email text`],
  ['users.email_api_key', `alter table users add column if not exists email_api_key text`],
  ['users.email_from', `alter table users add column if not exists email_from text`],
  ['users.telegram_bot_token', `alter table users add column if not exists telegram_bot_token text`],
  ['users.telegram_chat_id', `alter table users add column if not exists telegram_chat_id text`],
  ['users.email', `alter table users add column if not exists email text`],
  ['users.display_name', `alter table users add column if not exists display_name text`],
  ['users.avatar_url', `alter table users add column if not exists avatar_url text`],
  ['users.preferred_chain', `alter table users add column if not exists preferred_chain text default 'ethereum'`],
  ['users.privy_did', `alter table users add column if not exists privy_did text`],
  ['users.last_login_at', `alter table users add column if not exists last_login_at timestamptz`],
  ['users.metadata', `alter table users add column if not exists metadata jsonb default '{}'::jsonb`],

  // ── workflows — ERC-8183 trail + lifecycle ───────────────────
  ['workflows.erc8183_job_id', `alter table workflows add column if not exists erc8183_job_id text`],
  ['workflows.erc8183_create_tx', `alter table workflows add column if not exists erc8183_create_tx text`],
  ['workflows.erc8183_fund_tx', `alter table workflows add column if not exists erc8183_fund_tx text`],
  ['workflows.erc8183_submit_tx', `alter table workflows add column if not exists erc8183_submit_tx text`],
  ['workflows.erc8183_complete_tx', `alter table workflows add column if not exists erc8183_complete_tx text`],
  ['workflows.erc8183_set_budget_tx', `alter table workflows add column if not exists erc8183_set_budget_tx text`],
  ['workflows.erc8183_approve_tx', `alter table workflows add column if not exists erc8183_approve_tx text`],
  ['workflows.erc8183_deliverable_hash', `alter table workflows add column if not exists erc8183_deliverable_hash text`],
  ['workflows.erc8183_budget_usdc', `alter table workflows add column if not exists erc8183_budget_usdc text`],
  ['workflows.erc8183_reputation_tx', `alter table workflows add column if not exists erc8183_reputation_tx text`],
  ['workflows.title', `alter table workflows add column if not exists title text`],
  ['workflows.tags', `alter table workflows add column if not exists tags text[]`],
  ['workflows.archived_at', `alter table workflows add column if not exists archived_at timestamptz`],
  ['workflows.updated_at', `alter table workflows add column if not exists updated_at timestamptz default now()`],
  ['workflows.total_cost_credits', `alter table workflows add column if not exists total_cost_credits integer default 0`],
  ['workflows.metadata', `alter table workflows add column if not exists metadata jsonb default '{}'::jsonb`],

  // ── credit_ledger ────────────────────────────────────────────
  ['credit_ledger.metadata', `alter table credit_ledger add column if not exists metadata jsonb default '{}'::jsonb`],

  // ── skills — denormalized agent registry fields ──────────────
  ['skills.owner_id', `alter table skills add column if not exists owner_id uuid`],
  ['skills.agent_token_id', `alter table skills add column if not exists agent_token_id text`],
  ['skills.agent_tx_hash', `alter table skills add column if not exists agent_tx_hash text`],
  ['skills.agent_minted_at', `alter table skills add column if not exists agent_minted_at timestamptz`],
  ['skills.category', `alter table skills add column if not exists category text`],
  ['skills.display_name', `alter table skills add column if not exists display_name text`],
  ['skills.description', `alter table skills add column if not exists description text`],
  ['skills.cost_credits', `alter table skills add column if not exists cost_credits integer default 8`],
  ['skills.owner_wallet', `alter table skills add column if not exists owner_wallet text`],
  ['skills.enabled', `alter table skills add column if not exists enabled boolean default true`],
  ['skills.version', `alter table skills add column if not exists version text default '1'`],
  ['skills.agent_uri', `alter table skills add column if not exists agent_uri text`],
  ['skills.ipfs_cid', `alter table skills add column if not exists ipfs_cid text`],
  ['skills.provider_apis', `alter table skills add column if not exists provider_apis text[]`],
  ['skills.best_for_keywords', `alter table skills add column if not exists best_for_keywords text[]`],
  ['skills.metadata', `alter table skills add column if not exists metadata jsonb default '{}'::jsonb`],

  // ── nodes — full execution trace ─────────────────────────────
  ['nodes.skill_id', `alter table nodes add column if not exists skill_id uuid references skills(id)`],
  ['nodes.output', `alter table nodes add column if not exists output jsonb`],
  ['nodes.depends_on', `alter table nodes add column if not exists depends_on text[]`],
  ['nodes.input', `alter table nodes add column if not exists input jsonb`],
  ['nodes.error', `alter table nodes add column if not exists error text`],
  ['nodes.started_at', `alter table nodes add column if not exists started_at timestamptz`],
  ['nodes.finished_at', `alter table nodes add column if not exists finished_at timestamptz`],
  ['nodes.retry_count', `alter table nodes add column if not exists retry_count integer default 0`],
  ['nodes.cost_credits', `alter table nodes add column if not exists cost_credits integer default 0`],
  ['nodes.dispatch_tx', `alter table nodes add column if not exists dispatch_tx text`],
  ['nodes.metadata', `alter table nodes add column if not exists metadata jsonb default '{}'::jsonb`],

  // ── messages ─────────────────────────────────────────────────
  ['messages.content', `alter table messages add column if not exists content text`],
  ['messages.node_id', `alter table messages add column if not exists node_id uuid references nodes(id) on delete set null`],
  ['messages.tool_name', `alter table messages add column if not exists tool_name text`],
  ['messages.tool_payload', `alter table messages add column if not exists tool_payload jsonb`],
  ['messages.metadata', `alter table messages add column if not exists metadata jsonb default '{}'::jsonb`],

  // ── Disable RLS — server uses pooler, no per-row policies needed ──
  ['rls.users', `alter table users disable row level security`],
  ['rls.workflows', `alter table workflows disable row level security`],
  ['rls.credit_ledger', `alter table credit_ledger disable row level security`],
  ['rls.skills', `alter table skills disable row level security`],
  ['rls.nodes', `alter table nodes disable row level security`],
  ['rls.messages', `alter table messages disable row level security`],
  ['rls.nanopayment_events', `alter table nanopayment_events disable row level security`],
  ['rls.workflow_events', `alter table workflow_events disable row level security`],
  ['rls.agents', `alter table agents disable row level security`],
  ['rls.jobs', `alter table jobs disable row level security`],
  ['rls.negotiations', `alter table negotiations disable row level security`],
  ['rls.nanopayments', `alter table nanopayments disable row level security`],

  // ── Indexes ──────────────────────────────────────────────────
  ['idx.nanopayment_events_workflow', `create index if not exists nanopayment_events_workflow_id_idx on nanopayment_events(workflow_id)`],
  ['idx.workflow_events_workflow', `create index if not exists workflow_events_workflow_id_idx on workflow_events(workflow_id)`],
  ['idx.workflow_events_node', `create index if not exists workflow_events_node_id_idx on workflow_events(node_id)`],
  ['idx.workflow_events_created_at', `create index if not exists workflow_events_created_at_idx on workflow_events(created_at)`],

  ['idx.credit_ledger_user', `create index if not exists credit_ledger_user_idx on credit_ledger(user_id, created_at desc)`],
  ['idx.workflows_user', `create index if not exists workflows_user_idx on workflows(user_id, created_at desc)`],
  ['idx.workflows_status', `create index if not exists workflows_status_idx on workflows(status) where archived_at is null`],
  ['idx.nodes_workflow', `create index if not exists nodes_workflow_idx on nodes(workflow_id, created_at)`],
  ['idx.messages_workflow', `create index if not exists messages_workflow_idx on messages(workflow_id, created_at)`],
  ['idx.skills_category', `create index if not exists skills_category_idx on skills(category) where enabled = true`],
  ['idx.skills_enabled', `create index if not exists skills_enabled_idx on skills(enabled)`],
]

export async function POST(req: Request) {
  const guard = req.headers.get('x-migrate-token') ?? ''
  if (guard !== (process.env.MIGRATE_TOKEN ?? 'dev-migrate')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const applied: string[] = []
  const failed: Array<{ step: string; error: string }> = []

  for (const [label, stmt] of MIGRATIONS) {
    try {
      await db.execute(sql.raw(stmt))
      applied.push(label)
    } catch (e) {
      failed.push({
        step: label,
        error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
      })
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    applied_count: applied.length,
    failed_count: failed.length,
    applied,
    failed,
  })
}
