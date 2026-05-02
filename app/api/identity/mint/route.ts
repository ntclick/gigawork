import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getCurrentUser } from '@/lib/auth/session'
import { mintIdentity } from '@/lib/chain/identity'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

export async function POST() {
  const user = await getCurrentUser()

  if (user.identityTokenId) {
    return NextResponse.json({
      ok: true,
      already: true,
      tokenId: user.identityTokenId,
      txHash: user.identityTxHash,
    })
  }

  try {
    const { tokenId, txHash, contract } = await mintIdentity(user.wallet)

    await db
      .update(users)
      .set({
        identityTokenId: tokenId,
        identityTxHash: txHash,
        identityMintedAt: new Date(),
      })
      .where(eq(users.id, user.id))

    return NextResponse.json({
      ok: true,
      tokenId,
      txHash,
      contract,
      standard: 'ERC-8004',
      onChain: true,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[mint] failed', msg)
    return NextResponse.json(
      { error: 'mint_failed', detail: msg },
      { status: 500 },
    )
  }
}
