import { NextResponse } from 'next/server'

import { SKILLS } from '@/lib/skills/handlers'

type RouteCtx = { params: Promise<{ name: string }> }

/**
 * Public skill endpoint — thin shim. The real handler lives in
 * lib/skills/handlers.ts so the brain pipeline (lib/ai/tools.ts) can
 * invoke skills in-process instead of round-tripping through HTTP, which
 * is flaky on Vercel function-to-function self-loops.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const { name } = await ctx.params
  const handler = SKILLS[name]
  if (!handler) {
    return NextResponse.json({ error: `unknown skill ${name}` }, { status: 404 })
  }

  const input = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    const output = await handler(input)
    return NextResponse.json(output)
  } catch (e) {
    // Last-resort: never 500 the brain. Return a minimal error shape so the
    // composer can summarize "the data fetcher failed" instead of crashing
    // the whole workflow.
    const msg = e instanceof Error ? e.message : 'unknown error'
    return NextResponse.json(
      { error: msg, skill: name, fallback: true, generated_at: new Date().toISOString() },
      { status: 200 },
    )
  }
}
