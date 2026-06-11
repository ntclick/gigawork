/**
 * /api/health — diagnostic endpoint. Hit this URL directly in a browser to
 * find out which subsystem is breaking. Returns a JSON shape with the
 * status of each dependency. No auth required — only reports presence/
 * connectivity, never leaks credentials.
 */
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/client'

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {}

  // ── Env presence (don't log values) ─────────────────────────────
  checks.env_DATABASE_URL = { ok: !!process.env.DATABASE_URL }
  checks.env_KIMI_API_KEY = { ok: !!process.env.KIMI_API_KEY }
  checks.env_NEXT_PUBLIC_PRIVY_APP_ID = { ok: !!process.env.NEXT_PUBLIC_PRIVY_APP_ID }
  checks.env_ARC_RPC = {
    ok: !!process.env.NEXT_PUBLIC_ARC_RPC || !!process.env.ARC_RPC_URL,
  }

  // Confirm pooler URL — a direct (port 5432) URL is the #1 cause of
  // 503 storms on Vercel. Surface this clearly instead of letting the
  // user dig through Supabase docs.
  const dbUrl = process.env.DATABASE_URL ?? ''
  const usingPooler = /pooler\.supabase\.com|:6543\b/.test(dbUrl)
  const usingDirect = /:5432\b/.test(dbUrl)
  checks.db_using_pooler = {
    ok: !usingDirect,
    detail: usingDirect
      ? 'DATABASE_URL points at port 5432 (direct). Switch to the Transaction Pooler URL (port 6543) for Vercel — direct connections will exhaust on cold start and you will see /api/workflows 503 and /api/workflow 500.'
      : usingPooler
        ? 'pooler URL'
        : 'no DATABASE_URL set or unrecognized format',
  }

  // ── Live DB ping ────────────────────────────────────────────────
  try {
    const start = Date.now()
    await db.execute(sql`select 1 as ok`)
    checks.db_ping = { ok: true, detail: `${Date.now() - start}ms` }
  } catch (e) {
    checks.db_ping = {
      ok: false,
      detail: e instanceof Error ? e.message : 'unknown error',
    }
  }

  // ── Schema introspection — does the live DB actually have what we need? ──
  const schemaInfo: Record<string, unknown> = {}
  try {
    // Identify which DB instance we're connected to (host fingerprint)
    const meta = (await db.execute(sql`
      select current_database() as db, current_user as usr,
             inet_server_addr()::text as ip, inet_server_port() as port
    `)) as unknown as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
    const metaRow = Array.isArray(meta) ? meta[0] : meta?.rows?.[0]
    schemaInfo.connection = metaRow ?? null

    // Tables in public
    const tablesRes = (await db.execute(sql`
      select tablename from pg_tables where schemaname = 'public' order by tablename
    `)) as unknown as { rows?: Array<{ tablename: string }> } | Array<{ tablename: string }>
    const tables = Array.isArray(tablesRes) ? tablesRes : tablesRes?.rows ?? []
    schemaInfo.tables = tables.map((t) => t.tablename)

    // Workflow columns
    const colsRes = (await db.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'workflows'
      order by ordinal_position
    `)) as unknown as { rows?: Array<{ column_name: string }> } | Array<{ column_name: string }>
    const cols = Array.isArray(colsRes) ? colsRes : colsRes?.rows ?? []
    schemaInfo.workflows_columns = cols.map((c) => c.column_name)
    schemaInfo.has_erc8183_job_id = (cols as Array<{ column_name: string }>).some(
      (c) => c.column_name === 'erc8183_job_id',
    )

    // Skills count
    const skillsRes = (await db.execute(sql`select count(*)::int as count from skills`)) as unknown as
      | { rows?: Array<{ count: number }> }
      | Array<{ count: number }>
    const sk = Array.isArray(skillsRes) ? skillsRes : skillsRes?.rows ?? []
    schemaInfo.skills_count = sk[0]?.count ?? 0
  } catch (e) {
    schemaInfo.error = e instanceof Error ? e.message : 'introspection failed'
  }
  checks.schema = {
    ok: !!schemaInfo && (schemaInfo.has_erc8183_job_id as boolean) === true,
    detail: schemaInfo.has_erc8183_job_id
      ? 'workflows has erc8183_job_id'
      : 'workflows missing erc8183_job_id — Vercel is connecting to a DIFFERENT Supabase project than where you ran the migration SQL',
  }

  const allOk = Object.values(checks).every((c) => c.ok)
  return NextResponse.json(
    {
      ok: allOk,
      checks,
      schema: schemaInfo,
      hint: allOk
        ? 'Everything green.'
        : 'Compare schema.connection.db (what Vercel sees) with the project name in your Supabase Dashboard URL. If they differ, DATABASE_URL on Vercel points to the wrong project.',
    },
    { status: allOk ? 200 : 503 },
  )
}
