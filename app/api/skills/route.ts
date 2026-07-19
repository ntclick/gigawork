import { NextResponse } from 'next/server'

import { listAgents } from '@/lib/agents/registry'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await listAgents()
  return NextResponse.json({ skills: rows })
}
