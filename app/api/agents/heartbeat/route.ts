import { NextResponse } from 'next/server'
import { recoverMessageAddress } from 'viem'


import { db } from '@/lib/db/client'
import { agentLiveness, heartbeatLog } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'missing_body' }, { status: 400 })
    }

    const { agentAddress, timestamp, capacity, avgResponseMs, signature, skillTagsActive } = body

    if (!agentAddress || !timestamp || capacity === undefined || avgResponseMs === undefined || !signature) {
      return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
    }

    // 1. Verify timestamp to prevent replay attacks (allow up to 5 minutes of clock drift)
    const now = Date.now()
    const diff = Math.abs(now - Number(timestamp))
    if (diff > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'timestamp_skew_too_large' }, { status: 400 })
    }

    // 2. Construct the deterministic string message that was signed
    const message = `${agentAddress}:${timestamp}:${capacity}:${avgResponseMs}`

    // 3. Cryptographically recover the signer address from the signature
    let recoveredAddress: string
    try {
      recoveredAddress = await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`,
      })
    } catch (err) {
      return NextResponse.json({ error: 'signature_verification_failed', details: String(err) }, { status: 401 })
    }

    if (recoveredAddress.toLowerCase() !== agentAddress.toLowerCase()) {
      return NextResponse.json({ error: 'unauthorized_signature' }, { status: 401 })
    }

    // 4. Update the agent_liveness record (reset consecutiveJobFailures to 0 on success)
    await db
      .insert(agentLiveness)
      .values({
        agentAddress: agentAddress.toLowerCase(),
        status: 'ACTIVE',
        capacity: Number(capacity),
        avgResponseMs: Number(avgResponseMs),
        consecutiveJobFailures: 0,
        skillTagsActive: Array.isArray(skillTagsActive) ? skillTagsActive : null,
        lastHeartbeatAt: new Date(Number(timestamp)),
      })
      .onConflictDoUpdate({
        target: agentLiveness.agentAddress,
        set: {
          status: 'ACTIVE',
          capacity: Number(capacity),
          avgResponseMs: Number(avgResponseMs),
          consecutiveJobFailures: 0,
          skillTagsActive: Array.isArray(skillTagsActive) ? skillTagsActive : null,
          lastHeartbeatAt: new Date(Number(timestamp)),
        },
      })

    // 5. Append a heartbeat log entry
    await db.insert(heartbeatLog).values({
      agentAddress: agentAddress.toLowerCase(),
      timestamp: new Date(Number(timestamp)),
      capacity: Number(capacity),
      avgResponseMs: Number(avgResponseMs),
      rawPayload: body,
    })

    return NextResponse.json({ ok: true, status: 'ACTIVE' })
  } catch (e) {
    console.error('[/api/agents/heartbeat] failed', e)
    return NextResponse.json(
      { error: 'internal_error', message: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
