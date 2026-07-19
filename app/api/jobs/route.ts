import { NextResponse } from 'next/server'
import { getAllJobs } from '@/lib/supabase/jobs'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const list = await getAllJobs()

    const serialized = list.map((job) => ({
      ...job,
      onchainJobId: job.onchainJobId?.toString() || null,
    }))

    return NextResponse.json({ jobs: serialized })
  } catch (err) {
    console.error('[api/jobs] GET error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
