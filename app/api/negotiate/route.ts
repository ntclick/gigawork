import { type NextRequest, NextResponse } from 'next/server'
import { appendNegotiationMessage } from '@/lib/supabase/chat'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { jobId, agentId, role, message, priceOffer } = await req.json()

    if (!jobId || !agentId || !role || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: jobId, agentId, role, message' },
        { status: 400 }
      )
    }

    const chatMsg = await appendNegotiationMessage({
      jobId,
      agentId,
      role,
      message,
      priceOffer: priceOffer ? priceOffer.toString() : null,
    })

    return NextResponse.json({
      success: true,
      message: chatMsg,
    })
  } catch (err) {
    console.error('[api/negotiate] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
