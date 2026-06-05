import { type NextRequest, NextResponse } from 'next/server'
import {
  totalRevenueUsdc,
  totalApiCalls,
  totalFailedCalls,
  settlementQueue,
  requestLogs,
  resetRevenueCounters
} from '@/lib/chain/nanopayments'
import { AGENT_ENDPOINTS, AGENT_ENDPOINT_MAP } from '@/lib/nanopayments/config'

import { db } from '@/lib/db/client'
import { skills } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Count unique buyers from the settlement queue
  const uniqueBuyers = new Set(settlementQueue.map((item) => item.from.toLowerCase()))
  
  // Fetch on-chain agent data from db to enrich config endpoints
  let enrichedEndpoints = [...AGENT_ENDPOINTS]
  try {
    const dbSkills = await db.select().from(skills)
    const skillMap = new Map(dbSkills.map((s) => [s.name, s]))
    enrichedEndpoints = AGENT_ENDPOINTS.map((ep) => {
      const dbSkill = skillMap.get(ep.skill)
      return {
        ...ep,
        agentTokenId: dbSkill?.agentTokenId ?? null,
        reputationScore: dbSkill?.reputationScore ?? 0,
      }
    })
  } catch (err) {
    console.error('[stats] failed to fetch db skills:', err)
  }
  
  return NextResponse.json({
    totalRevenueUsdc,
    totalApiCalls,
    totalFailedCalls,
    activeBuyersCount: uniqueBuyers.size,
    settlementQueue: settlementQueue.slice(-20), // return last 20 settlements
    requestLogs: requestLogs.slice(-50), // return last 50 logs for live stream
    endpoints: enrichedEndpoints,
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, skill, enabled, priceUsdc } = body

    if (action === 'withdraw' || action === 'reset') {
      resetRevenueCounters()
      return NextResponse.json({ success: true, message: 'Revenue counters reset successfully' })
    }
    
    if (!skill) {
      return NextResponse.json({ error: 'Skill name is required' }, { status: 400 })
    }
    
    const ep = AGENT_ENDPOINT_MAP.get(skill)
    if (!ep) {
      return NextResponse.json({ error: `Unknown skill: ${skill}` }, { status: 404 })
    }
    
    if (enabled !== undefined) {
      ep.enabled = enabled
    }
    
    if (priceUsdc !== undefined) {
      // Basic validation
      const price = parseFloat(priceUsdc)
      if (isNaN(price) || price < 0) {
        return NextResponse.json({ error: 'Invalid price' }, { status: 400 })
      }
      ep.priceUsdc = priceUsdc
    }
    
    return NextResponse.json({ success: true, endpoint: ep })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
