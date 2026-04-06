-- GigaWork Supabase Schema
-- Run this in Supabase SQL Editor

-- ─── users ───────────────────────────────────────────────
create table if not exists users (
  address           text primary key,
  roles             text[] default '{client}', -- e.g. {client, agent_operator}
  nonce             text,
  usdc_balance      numeric(20,6) not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ─── usdc_deposits ──────────────────────────────────────
create table if not exists usdc_deposits (
  id              uuid primary key default gen_random_uuid(),
  wallet          text not null,
  amount          numeric(20,6) not null,
  tx_hash         text not null unique,
  confirmed_at    timestamptz default now()
);

-- ─── agents ──────────────────────────────────────────────
create table if not exists agents (
  address           text primary key,
  erc8004_token_id  bigint not null,
  hourly_rate_usdc  numeric(20,6) not null,
  billing_unit      text default 'hour',
  skill_tags        text[] default '{}',
  reputation_score  int not null default 500,
  total_jobs_done   int not null default 0,
  total_earned_usdc numeric(20,6) not null default 0,
  is_active         boolean not null default true,
  metadata_uri      text,  -- ERC-8004 AgentURI
  metadata_hash     text,  -- Integrity hash
  webhook_uri       text,  -- External execution endpoint
  -- Metrics
  stake_amount      numeric(20,6) default 0,
  stake_tier        text default 'NONE',
  total_bids        int default 0,
  win_rate          numeric(5,2) default 0,
  avg_response_time_s int,
  avg_completion_time_s int,
  dispute_count     int default 0,
  last_active_at    timestamptz,
  -- Timestamps
  registered_at     timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_agents_tags   on agents using gin(skill_tags);
create index if not exists idx_agents_active on agents(is_active, reputation_score desc);

-- ─── jobs ────────────────────────────────────────────────
create table if not exists jobs (
  job_id            bigint primary key,
  employer          text not null,
  worker_agent      text references agents(address),
  job_type          text not null,
  metadata_uri      text, -- Off-chain job metadata
  metadata_hash     text,
  hourly_rate_usdc  numeric(20,6),
  estimated_hours   numeric(6,2),
  billing_unit      text default 'hour',
  deposit_amount    numeric(20,6),
  actual_charge     numeric(20,6),
  worker_payout     numeric(20,6),
  platform_fee      numeric(20,6),
  status            text not null default 'PENDING_FUND'
    check (status in ('PENDING_FUND', 'ACTIVE', 'SUBMITTED', 'REVISION_REQUESTED', 'COMPLETED', 'REJECTED', 'EXPIRED')),
  result_hash       text,
  proof_uri         text,
  employer_rating   int,
  -- specific events tx logging
  tx_hash_posted    text,
  tx_hash_accepted  text,
  tx_hash_settled   text,
  -- Timestamps
  start_ts          timestamptz,
  end_ts            timestamptz,
  result_submitted_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_jobs_status   on jobs(status);
create index if not exists idx_jobs_worker   on jobs(worker_agent);
create index if not exists idx_jobs_employer on jobs(employer);

-- ─── bids ────────────────────────────────────────────────
create table if not exists bids (
  id              uuid primary key default gen_random_uuid(),
  job_id          bigint not null references jobs(job_id),
  agent_address   text not null references agents(address),
  proposed_rate   numeric(20,6) not null,
  note            text,
  status          text not null default 'PENDING'
    check (status in ('PENDING','ACCEPTED','REJECTED')),
  created_at      timestamptz not null default now()
);

create index if not exists idx_bids_job_id on bids(job_id);
create index if not exists idx_bids_agent  on bids(agent_address);

-- ─── Disputes (for long term) ────────────────────────────
create table if not exists disputes (
  id            uuid primary key default gen_random_uuid(),
  job_id        bigint not null references jobs(job_id),
  raised_by     text not null,
  reason        text not null,
  resolution    text,
  worker_won    boolean,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_disputes_raised_by on disputes(raised_by);
create index if not exists idx_disputes_job_id    on disputes(job_id);

-- ─── job_events ──────────────────────────────────────────
create table if not exists job_events (
  id          uuid primary key default gen_random_uuid(),
  job_id      bigint not null references jobs(job_id),
  event_type  text not null,
  actor       text,
  tx_hash     text,
  data        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_job_events_job on job_events(job_id, created_at);

-- ─── agent_activity_log ──────────────────────────────────
create table if not exists agent_activity_log (
  id          uuid primary key default gen_random_uuid(),
  agent       text not null references agents(address),
  action      text not null,
  job_id      bigint references jobs(job_id),
  amount_usdc numeric(20,6),
  tx_hash     text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_agent_activity_agent on agent_activity_log(agent);
create index if not exists idx_agent_activity_job   on agent_activity_log(job_id);

-- ─── platform_metrics ────────────────────────────────────
create table if not exists platform_metrics (
  date              date primary key,
  total_agents      int not null default 0,
  active_agents     int not null default 0,
  new_agents        int not null default 0,
  total_jobs        int not null default 0,
  new_jobs          int not null default 0,
  jobs_settled      int not null default 0,
  jobs_disputed     int not null default 0,
  total_volume_usdc numeric(20,6) not null default 0,
  total_payout_usdc numeric(20,6) not null default 0,
  platform_fee_usdc numeric(20,6) not null default 0,
  avg_job_time_hrs  numeric(10,2),
  avg_bid_count     numeric(10,2),
  created_at        timestamptz not null default now()
);

-- ─── agent_metrics_daily ─────────────────────────────────
create table if not exists agent_metrics_daily (
  id              uuid primary key default gen_random_uuid(),
  agent           text not null references agents(address),
  date            date not null,
  bids_placed     int not null default 0,
  bids_accepted   int not null default 0,
  bids_rejected   int not null default 0,
  jobs_completed  int not null default 0,
  earned_usdc     numeric(20,6) not null default 0,
  avg_response_s  int,
  avg_complete_s  int,
  reputation_delta int not null default 0,
  unique(agent, date)
);

-- ─── Realtime ────────────────────────────────────────────
alter publication supabase_realtime add table jobs;
alter publication supabase_realtime add table bids;

-- ─── Updated_at triggers ─────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists users_updated_at on users;
create trigger users_updated_at before update on users
  for each row execute function update_updated_at();

drop trigger if exists agents_updated_at on agents;
create trigger agents_updated_at before update on agents
  for each row execute function update_updated_at();

drop trigger if exists jobs_updated_at on jobs;
create trigger jobs_updated_at before update on jobs
  for each row execute function update_updated_at();

-- ─── RLS Policies ────────────────────────────────────────
--
-- IMPORTANT: The Go backend uses the Supabase service_role key,
-- which BYPASSES all RLS policies. These policies protect against:
--   1. Direct access via Supabase anon key (frontend JS, public PostgREST)
--   2. Future migration to user-scoped JWTs (auth.uid() / app_metadata)
--
-- To enforce RLS in the Go backend, switch from service_role key to
-- per-request JWTs with the user's wallet address in app_metadata.
-- Then replace service_all_* policies with authenticated_* policies below.
--

alter table users enable row level security;
alter table agents enable row level security;
alter table jobs enable row level security;
alter table bids enable row level security;
alter table disputes enable row level security;
alter table job_events enable row level security;
alter table agent_activity_log enable row level security;
alter table platform_metrics enable row level security;
alter table agent_metrics_daily enable row level security;

-- ═══════════════════════════════════════════════════════════
-- SERVICE ROLE: full access (used by Go backend via service key)
-- These are intentionally using (true) — service_role is trusted.
-- ═══════════════════════════════════════════════════════════
create policy "service_all_users"    on users for all to service_role using (true) with check (true);
create policy "service_all_agents"   on agents for all to service_role using (true) with check (true);
create policy "service_all_jobs"     on jobs for all to service_role using (true) with check (true);
create policy "service_all_bids"     on bids for all to service_role using (true) with check (true);
create policy "service_all_disputes" on disputes for all to service_role using (true) with check (true);
create policy "service_all_job_evt" on job_events for all to service_role using (true) with check (true);
create policy "service_all_agt_act" on agent_activity_log for all to service_role using (true) with check (true);
create policy "service_all_plat_met" on platform_metrics for all to service_role using (true) with check (true);
create policy "service_all_agt_met"  on agent_metrics_daily for all to service_role using (true) with check (true);

-- ═══════════════════════════════════════════════════════════
-- ANON: restricted read-only on public data only
-- Anyone with the Supabase anon key (including frontend JS) gets these.
-- ═══════════════════════════════════════════════════════════

-- Agents: only active agents (hide deactivated/system agents)
-- Note: visible_on_marketplace and status columns exist in DB (added via
-- Supabase dashboard) but not in this DDL. If those columns are present,
-- replace this policy with:
--   using (is_active = true and visible_on_marketplace = true and status = 'active')
create policy "anon_read_agents" on agents for select to anon
  using (is_active = true);

-- Jobs: only open marketplace jobs (not private, not settled, not user-specific)
create policy "anon_read_jobs" on jobs for select to anon
  using (status in ('PENDING_FUND', 'ACTIVE'));

-- Platform metrics: public stats are fine
create policy "anon_read_plat_met" on platform_metrics for select to anon using (true);

-- Everything else: NO anonymous access
-- users: contains nonces, wallet addresses, roles → private
-- bids: contains agent strategies and rates → private
-- disputes: contains dispute details → private
-- job_events: internal audit trail → private
-- agent_activity_log: internal tracking → private
-- agent_metrics_daily: internal analytics → private

-- ═══════════════════════════════════════════════════════════
-- AUTHENTICATED: user-scoped access via JWT
-- These use auth.jwt() -> 'app_metadata' -> 'wallet_address' to
-- identify the current user. Requires setting wallet_address in
-- the JWT's app_metadata during Supabase Auth or custom JWT signing.
--
-- Currently NOT enforced (backend uses service_role).
-- Activate these when migrating to per-user JWT auth.
-- ═══════════════════════════════════════════════════════════

-- Users: can only read/update own record
create policy "auth_users_own" on users for all to authenticated
  using (address = current_setting('request.jwt.claims', true)::json->>'wallet_address')
  with check (address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Agents: can read all active, can update own
create policy "auth_agents_read" on agents for select to authenticated
  using (is_active = true);
create policy "auth_agents_write_own" on agents for update to authenticated
  using (address = current_setting('request.jwt.claims', true)::json->>'wallet_address')
  with check (address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Jobs: can read own jobs (as employer or worker) + open jobs
create policy "auth_jobs_read" on jobs for select to authenticated
  using (
    employer = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    or worker_agent = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    or status in ('PENDING_FUND', 'ACTIVE')
  );
create policy "auth_jobs_insert" on jobs for insert to authenticated
  with check (employer = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Bids: can read own bids, can insert own bids
create policy "auth_bids_read" on bids for select to authenticated
  using (agent_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');
create policy "auth_bids_insert" on bids for insert to authenticated
  with check (agent_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Disputes: can read own disputes
create policy "auth_disputes_read" on disputes for select to authenticated
  using (raised_by = current_setting('request.jwt.claims', true)::json->>'wallet_address');
create policy "auth_disputes_insert" on disputes for insert to authenticated
  with check (raised_by = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Job events: read events for own jobs
create policy "auth_job_events_read" on job_events for select to authenticated
  using (
    job_id in (
      select job_id from jobs
      where employer = current_setting('request.jwt.claims', true)::json->>'wallet_address'
         or worker_agent = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    )
  );

-- Agent activity: read own activity
create policy "auth_agent_activity_read" on agent_activity_log for select to authenticated
  using (agent = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Metrics: read-only for authenticated
create policy "auth_plat_met_read" on platform_metrics for select to authenticated using (true);
create policy "auth_agt_met_read" on agent_metrics_daily for select to authenticated
  using (agent = current_setting('request.jwt.claims', true)::json->>'wallet_address');
