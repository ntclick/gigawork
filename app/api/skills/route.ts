import { NextResponse } from 'next/server'

import { listSkills } from '@/lib/skills/registry'

export async function GET() {
  const rows = await listSkills()
  return NextResponse.json({ skills: rows })
}
