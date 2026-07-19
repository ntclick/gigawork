import { type NextRequest, NextResponse } from 'next/server'
import { getNegotiationChat } from '@/lib/supabase/chat'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ jobId: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx) {
  try {
    const { jobId } = await ctx.params

    const messages = await getNegotiationChat(jobId)

    return NextResponse.json({ messages })
  } catch (err) {
    console.error('[api/negotiate/[jobId]] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
