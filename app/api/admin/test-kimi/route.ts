/**
 * /api/admin/test-kimi — fire a tiny Kimi (Moonshot) chat call to verify
 * the API key + reachability. When workflow brain never streams a single
 * token, this endpoint pinpoints whether Kimi itself is blocked/auth-bad
 * vs the brain pipeline being broken.
 *
 * Auth: X-Migrate-Token header or ?token= query.
 */
import { NextResponse } from 'next/server'

import { curlFetchJSON } from '@/lib/skills/curlFetch'

export async function GET(req: Request) {
  const guard =
    req.headers.get('x-migrate-token') ??
    new URL(req.url).searchParams.get('token') ??
    ''
  if (guard !== (process.env.MIGRATE_TOKEN ?? 'dev-migrate')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const apiKey = process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY ?? ''
  const baseUrl = process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1'
  const model = process.env.KIMI_MODEL ?? 'kimi-k2-0905-preview'

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: 'KIMI_API_KEY missing on server',
    })
  }

  // Try plain fetch first (what the AI SDK uses) — if Vercel's undici
  // gets 403/401 from Kimi, we want to see the exact body.
  let undiciResult: Record<string, unknown> = {}
  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say "ping" and stop.' }],
        max_tokens: 8,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = await r.text()
    undiciResult = {
      status: r.status,
      body_preview: body.slice(0, 800),
    }
  } catch (e) {
    undiciResult = {
      error: e instanceof Error ? e.message : String(e),
    }
  }

  // Same call via curl + DoH — if undici fails, see if curl can reach it
  let curlResult: Record<string, unknown> = {}
  try {
    const r = await curlFetchJSON<{
      choices?: { message?: { content?: string } }[]
      error?: unknown
    }>(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say "ping" and stop.' }],
        max_tokens: 8,
      }),
      timeoutMs: 15_000,
    })
    curlResult = {
      ok: true,
      content: r.choices?.[0]?.message?.content ?? '(empty)',
      raw_error: r.error,
    }
  } catch (e) {
    curlResult = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  return NextResponse.json({
    config: {
      base_url: baseUrl,
      model,
      api_key_length: apiKey.length,
      api_key_prefix: apiKey.slice(0, 8),
    },
    via_undici: undiciResult,
    via_curl: curlResult,
    hint:
      'If via_undici has status>=400 but via_curl ok=true → Cloudflare is blocking Vercel\'s undici by JA3 fingerprint. Solution: route brain.ts streamText through a curl-backed transport, or front Kimi with a proxy.',
  })
}
