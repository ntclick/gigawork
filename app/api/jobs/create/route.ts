import { type NextRequest, NextResponse } from 'next/server'
import { createJobInDb } from '@/lib/supabase/jobs'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { clientAgentId, providerAgentId, budgetUsdc, description } = await req.json()

    if (!clientAgentId || !providerAgentId || !budgetUsdc) {
      return NextResponse.json(
        { error: 'Missing required fields: clientAgentId, providerAgentId, budgetUsdc' },
        { status: 400 }
      )
    }

    const job = await createJobInDb({
      clientAgentId,
      providerAgentId,
      status: 'Open',
      budgetUsdc: budgetUsdc.toString(),
      description: description ?? '',
    })

    return NextResponse.json({
      success: true,
      job,
    })
  } catch (err) {
    console.error('[api/jobs/create] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
