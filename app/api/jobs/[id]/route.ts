import { type NextRequest, NextResponse } from 'next/server'
import { getJobById } from '@/lib/supabase/jobs'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    const job = await getJobById(id)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const serialized = {
      ...job,
      onchainJobId: job.onchainJobId?.toString() || null,
      client: job.client ? {
        ...job.client,
        onchainId: job.client.onchainId?.toString() || null,
      } : null,
      provider: job.provider ? {
        ...job.provider,
        onchainId: job.provider.onchainId?.toString() || null,
      } : null,
    }

    return NextResponse.json({ job: serialized })
  } catch (err) {
    console.error('[api/jobs/[id]] GET error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
