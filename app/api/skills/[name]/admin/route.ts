import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { skills } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params
  
  // Admin address validation
  const adminAddress = req.headers.get('x-admin-address')
  if (adminAddress?.toLowerCase() !== '0xafe6dd950dc2cf561e8daba1725e0e6840f70549') {
    return NextResponse.json({ error: 'Unauthorized admin access' }, { status: 401 })
  }

  try {
    const { disabled, priceOverride } = await req.json()

    // 1. Fetch current skill row
    const [skill] = await db.select().from(skills).where(eq(skills.name, name)).limit(1)
    if (!skill) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    // 2. Modify manifest JSONB
    const manifest = { ...(skill.manifest as Record<string, unknown> ?? {}) }
    if (disabled !== undefined) {
      manifest['disabled'] = disabled
    }
    if (priceOverride !== undefined) {
      manifest['price_override'] = priceOverride
    }

    // 3. Update in database
    await db.update(skills).set({ manifest }).where(eq(skills.id, skill.id))

    return NextResponse.json({ success: true, manifest })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
