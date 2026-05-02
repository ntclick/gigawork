import { NextResponse } from 'next/server'
import { Agent, fetch as undiciFetch } from 'undici'

import { dohFetchJSON, probeDoh } from '@/lib/skills/dohFetch'

/**
 * DoH debug endpoint — diagnoses why dohFetch is failing.
 * GET /api/_doh-debug?host=gamma-api.polymarket.com
 *
 * Steps:
 *  1. Manual DoH lookup via 1.1.1.1 (no agent — direct undici fetch)
 *  2. Resolve via our dohResolve helper
 *  3. Real GET to the host's /markets endpoint via dohFetchJSON
 * Each step's error is surfaced separately so we know which layer breaks.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const host = url.searchParams.get('host') ?? 'gamma-api.polymarket.com'
  const path = url.searchParams.get('path') ?? '/markets?limit=1'

  const out: Record<string, unknown> = { host, path, steps: {} }
  const steps = out.steps as Record<string, unknown>

  // Step 1: raw DoH query
  try {
    const r = await undiciFetch(`https://1.1.1.1/dns-query?name=${host}&type=A`, {
      headers: { accept: 'application/dns-json' },
    })
    steps.step1_doh_raw = { ok: r.ok, status: r.status, body: await r.json() }
  } catch (e) {
    const cause = (e as Error & { cause?: { message?: string; code?: string } }).cause
    steps.step1_doh_raw = {
      error: e instanceof Error ? e.message : 'unknown',
      cause_message: cause?.message,
      cause_code: cause?.code,
    }
  }

  // Step 2: through our resolver
  steps.step2_resolve = await probeDoh(host)

  // Step 3: full DoH-routed GET (no UA — bare)
  try {
    const data = await dohFetchJSON(`https://${host}${path}`, { timeoutMs: 15_000 })
    steps.step3_full_fetch = {
      ok: true,
      preview: typeof data === 'string' ? data.slice(0, 200) : Array.isArray(data) ? `array len ${data.length}` : 'json received',
    }
  } catch (e) {
    steps.step3_full_fetch = { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }

  // Step 3b: with Chrome UA — bypasses Cloudflare bot block
  try {
    const data = await dohFetchJSON(`https://${host}${path}`, {
      timeoutMs: 15_000,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        accept: 'application/json',
      },
    })
    steps.step3b_with_ua = {
      ok: true,
      preview: typeof data === 'string' ? data.slice(0, 200) : Array.isArray(data) ? `array len ${data.length}` : 'json received',
    }
  } catch (e) {
    steps.step3b_with_ua = { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }

  // Step 4: bare undici test (no agent) — see if Cloudflare 1.1.1.1 itself works
  try {
    const r = await undiciFetch(`https://1.1.1.1/dns-query?name=cloudflare.com&type=A`, {
      headers: { accept: 'application/dns-json' },
    })
    steps.step4_doh_alive = { ok: r.ok, status: r.status }
  } catch (e) {
    steps.step4_doh_alive = { error: e instanceof Error ? e.message : 'unknown' }
  }

  // Step 5: check what runtime we're on
  steps.step5_runtime = {
    node_version: process.version,
    next_runtime: typeof EdgeRuntime === 'undefined' ? 'node' : 'edge',
  }

  // Make the agent stay alive even after function returns
  void Agent

  return NextResponse.json(out, { status: 200 })
}

declare const EdgeRuntime: unknown
