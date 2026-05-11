import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getCurrentUser, AuthRequiredError } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { skills } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

const registerProviderSchema = z.object({
  name: z
    .string()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase slug format, e.g. wallet-risk-checker'),
  displayName: z.string().min(3).max(80),
  description: z.string().min(20).max(600),
  endpoint: z.string().url().refine((url) => url.startsWith('https://'), 'Endpoint must be HTTPS'),
  category: z.string().min(2).max(40).default('general'),
  costCredits: z.coerce.number().int().min(0).max(100).default(8),
  inputSchema: z
    .object({
      type: z.literal('object').default('object'),
      required: z.array(z.string()).default([]),
      properties: z.record(z.string(), z.unknown()).default({}),
    })
    .default({ type: 'object', required: [], properties: {} }),
  providerApis: z.array(z.string()).max(12).default([]),
  keywords: z.array(z.string()).max(12).default([]),
})

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    const body = registerProviderSchema.parse(await req.json())
    const manifest = {
      schema_version: '1.0',
      display_name: body.displayName,
      description: body.description,
      category: body.category,
      cost_credits: body.costCredits,
      input_schema: body.inputSchema,
      provider_apis: body.providerApis,
      best_for_keywords: body.keywords,
      registration_status: 'draft',
    }

    const [row] = await db
      .insert(skills)
      .values({
        name: body.name,
        manifest,
        endpoint: body.endpoint,
        ownerId: user.id,
      })
      .returning()

    return NextResponse.json({ ok: true, skill: row })
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'Connect a wallet before registering a provider.' }, { status: 401 })
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid provider profile.', issues: e.issues }, { status: 400 })
    }
    const message = e instanceof Error ? e.message : String(e)
    const status = /duplicate key|unique/i.test(message) ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
