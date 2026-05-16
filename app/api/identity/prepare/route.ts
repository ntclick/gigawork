import { NextResponse } from 'next/server'

import { eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { arcTestnet } from '@/lib/chain/client'
import { checkOnChainIdentity, prepareMintCalldata } from '@/lib/chain/identity'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

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

  // One NFT per wallet rule: before handing out fresh `register()`
  // calldata, check the chain. If the wallet already owns ANY
  // identity NFT, hydrate the DB with the OLDEST one (checkOnChainIdentity
  // returns the lowest tokenId among everything the wallet owns) and
  // short-circuit with `already: true`. This:
  //   - Prevents accidental double-mint when the user clicks Mint
  //     after a transient DB row reset, or migrates from a different
  //     frontend that already minted on their behalf.
  //   - Stabilizes provider/evaluator agent bindings — picking the
  //     oldest deterministically means /api/me + /api/workflow never
  //     disagree about which tokenId represents this client.
  const existingOnChain = await checkOnChainIdentity(user.wallet)
  if (existingOnChain) {
    try {
      await db
        .update(users)
        .set({ identityTokenId: existingOnChain })
        .where(eq(users.id, user.id))
    } catch (e) {
      console.warn(
        '[identity/prepare] failed to persist on-chain tokenId',
        e instanceof Error ? e.message : e,
      )
    }
    return NextResponse.json({
      ok: true,
      already: true,
      tokenId: existingOnChain,
      txHash: null,
      source: 'on-chain',
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
