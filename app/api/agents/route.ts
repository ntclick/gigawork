import { type NextRequest, NextResponse } from 'next/server'
import { getAllAgents } from '@/lib/supabase/agents'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') // 'client' | 'provider'

    const filter: { type?: 'client' | 'provider'; isActive: boolean } = {
      isActive: true,
    }

    if (type === 'client' || type === 'provider') {
      filter.type = type
    }

    const list = await getAllAgents(filter)

    // Convert BigInts to string for JSON serialization
    const serialized = list.map((a) => ({
      ...a,
      onchainId: a.onchainId?.toString(),
    }))

    return NextResponse.json({ agents: serialized })
  } catch (err) {
    console.error('[api/agents] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
