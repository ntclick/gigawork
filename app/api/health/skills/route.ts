import { NextResponse } from 'next/server'
import { pingAllSkillNodes } from '@/lib/skills/healthMonitor'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true' || url.searchParams.get('force') === '1'
  const snapshot = await pingAllSkillNodes(force)
  return NextResponse.json(snapshot)
}

export async function POST() {
  const snapshot = await pingAllSkillNodes(true)
  return NextResponse.json(snapshot)
}
