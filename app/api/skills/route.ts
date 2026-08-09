import { NextResponse } from 'next/server'

import { listAgents } from '@/lib/agents/registry'

export const dynamic = 'force-dynamic'

let cachedSkills: any[] | null = null
let lastSkillsFetch = 0
const SKILLS_CACHE_TTL = 15_000

export async function GET() {
  const now = Date.now()
  if (cachedSkills && now - lastSkillsFetch < SKILLS_CACHE_TTL) {
    return NextResponse.json({ skills: cachedSkills })
  }
  const rows = await listAgents()
  cachedSkills = rows
  lastSkillsFetch = now
  return NextResponse.json({ skills: rows })
}
