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

  const allOk = Object.values(checks).every((c) => c.ok)
  return NextResponse.json(
    {
      ok: allOk,
      checks,
      hint: allOk
        ? 'Everything green. If /api/workflow still 500s, deploy may be stale — wait for Vercel to finish.'
        : 'One or more checks failed. Fix the red ones above and the 503 storm should clear.',
    },
    { status: allOk ? 200 : 503 },
  )
}
