import { NextResponse } from 'next/server'
import { decodeEventLog, parseAbi } from 'viem'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { getCurrentUser } from '@/lib/auth/session'
import { publicClient } from '@/lib/chain/client'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

const Body = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
})

const IDENTITY_REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS ?? '') as `0x${string}`

const abi = parseAbi([
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
])

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const user = await getCurrentUser()

  if (user.identityTokenId) {
    return NextResponse.json({
      ok: true,
      already: true,
      tokenId: user.identityTokenId,
      txHash: user.identityTxHash,
    })
  }

  // Read on-chain to verify the user actually signed the mint themselves.
  // We refuse to trust the client-supplied txHash — it must show:
  //   1. Tx is mined and successful
  //   2. tx.from == user.wallet (user signed, not a relayer)
  //   3. Registered/Transfer event minted to user.wallet
  let receipt
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash: parsed.data.txHash as `0x${string}`,
      timeout: 25_000,
      retryCount: 2,
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'tx_not_found', detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }

  if (receipt.status !== 'success') {
    return NextResponse.json({ error: 'tx_reverted' }, { status: 400 })
  }

  const tx = await publicClient.getTransaction({ hash: parsed.data.txHash as `0x${string}` })
  if (tx.from.toLowerCase() !== user.wallet.toLowerCase()) {
    return NextResponse.json(
      {
        error: 'wrong_signer',
        detail: `expected from=${user.wallet}, got from=${tx.from}`,
      },
      { status: 400 },
    )
  }

  let tokenId: string | null = null
  let owner: string | null = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'Registered') {
        tokenId = decoded.args.agentId.toString()
        owner = decoded.args.owner
        break
      }
      if (decoded.eventName === 'Transfer' && !tokenId) {
        tokenId = decoded.args.tokenId.toString()
        owner = decoded.args.to
      }
    } catch {
      /* skip */
    }
  }

  if (!tokenId || !owner) {
    return NextResponse.json({ error: 'no_register_event' }, { status: 400 })
  }
  if (owner.toLowerCase() !== user.wallet.toLowerCase()) {
    return NextResponse.json(
      { error: 'wrong_owner', detail: `tokenId ${tokenId} owned by ${owner}, not ${user.wallet}` },
      { status: 400 },
    )
  }

  await db
    .update(users)
    .set({
      identityTokenId: tokenId,
      identityTxHash: parsed.data.txHash,
      identityMintedAt: new Date(),
    })
    .where(eq(users.id, user.id))

  return NextResponse.json({
    ok: true,
    tokenId,
    txHash: parsed.data.txHash,
    contract: IDENTITY_REGISTRY,
    standard: 'ERC-8004',
    role: 'client',
    onChain: true,
    userOwned: true,
  })
}
