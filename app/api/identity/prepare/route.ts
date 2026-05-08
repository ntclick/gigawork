import { NextResponse } from 'next/server'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { arcTestnet } from '@/lib/chain/client'
import { prepareMintCalldata } from '@/lib/chain/identity'

/**
 * POST /api/identity/prepare
 *
 * Returns the calldata + contract address + agentURI for the user's Privy
 * embedded wallet to call IdentityRegistry.register() directly. The user
 * signs the resulting tx and POSTs the hash to /api/identity/confirm for
 * server-side verification and DB write.
 *
 * Why a prepare endpoint instead of letting the frontend hardcode the ABI:
 *   - agentURI is server-derived (uses NEXT_PUBLIC_APP_URL + canonical wallet)
 *   - Single source of truth for the encoding — frontend can't drift
 *   - 200 with `already` short-circuits if the user re-clicks after success
 */
export async function POST() {
  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  if (user.identityTokenId) {
    return NextResponse.json({
      ok: true,
      already: true,
      tokenId: user.identityTokenId,
      txHash: user.identityTxHash,
    })
  }

  try {
    const { calldata, contract, agentURI } = prepareMintCalldata(user.wallet)
    return NextResponse.json({
      ok: true,
      calldata,
      contract,
      agentURI,
      chainId: arcTestnet.id,
      standard: 'ERC-8004',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[identity/prepare] failed', msg)
    return NextResponse.json(
      { error: 'prepare_failed', detail: msg },
      { status: 500 },
    )
  }
}
