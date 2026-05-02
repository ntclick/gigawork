import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { messages, workflows } from '@/lib/db/schema'

const Body = z.object({
  prompt: z.string().min(4).max(4000),
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const user = await getCurrentUser()

  if (!user.identityTokenId) {
    return NextResponse.json(
      {
        error: 'identity_required',
        standard: 'ERC-8004',
        message: 'Mint your ERC-8004 identity NFT before posting an ERC-8183 job.',
      },
      { status: 403 },
    )
  }

  const [wf] = await withDbRetry(
    () => db
      .insert(workflows)
      .values({ prompt: parsed.data.prompt, userId: user.id })
      .returning(),
    { label: 'workflow:create' },
  )

  await withDbRetry(
    () => db.insert(messages).values({
      workflowId: wf.id,
      role: 'user',
      content: parsed.data.prompt,
    }),
    { label: 'workflow:seed-message' },
  )

  return NextResponse.json({ id: wf.id, userId: user.id })
}
