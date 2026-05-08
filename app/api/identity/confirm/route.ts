import { NextResponse } from 'next/server'
import { decodeEventLog, parseAbi } from 'viem'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { publicClient } from '@/lib/chain/client'
import { prefundUserWallet } from '@/lib/credits/postMintHooks'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

const Body = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
})

// Same fallback the IdentityGate frontend uses — without this, if the env
// is missing on the deploy, every log address compare misses (empty string
// matches nothing) and we always 400 'no_register_event' even for a
// successful mint, so the gate keeps re-prompting forever.
const IDENTITY_REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS ??
  process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ??
  '0x8004A818BFB912233c491871b3d84c89A494BD9e') as `0x${string}`

const abi = parseAbi([
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
])

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

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
  const matchedRegistryLogs: Array<{ topics: readonly string[]; data: string }> = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()) continue
    matchedRegistryLogs.push({ topics: log.topics, data: log.data })
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
      /* skip non-matching event signatures */
    }
  }

  // Last-resort: standard ERC-721 Transfer has tokenId as topic[3]. If our
  // ABI parse missed it (different indexed/non-indexed layout in the deployed
  // contract), fall back to reading topics directly.
  if (!tokenId) {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()) continue
      // Transfer signature: 0xddf252ad... ; topics[2] = to, topics[3] = tokenId
      if (
        log.topics.length === 4 &&
        log.topics[0]?.toLowerCase() ===
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
      ) {
        const toHex = log.topics[2]
        const idHex = log.topics[3]
        if (toHex && idHex) {
          owner = `0x${toHex.slice(26)}`
          tokenId = BigInt(idHex).toString()
          break
        }
      }
    }
  }

  if (!tokenId || !owner) {
    return NextResponse.json(
      {
        error: 'no_register_event',
        registry: IDENTITY_REGISTRY,
        receipt_logs_count: receipt.logs.length,
        matched_registry_logs: matchedRegistryLogs.length,
        sample_topics: matchedRegistryLogs.slice(0, 3).map((l) => l.topics),
        hint:
          matchedRegistryLogs.length === 0
            ? 'No log emitted from the registry contract. Either the tx targeted a different contract than IDENTITY_REGISTRY_ADDRESS, or the registry env on the server points to the wrong address.'
            : 'Registry emitted logs but neither Registered nor Transfer signature matched. Inspect sample_topics and update the parseAbi list in identity/confirm.',
      },
      { status: 400 },
    )
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

  // Post-mint side effects (gated by PREFUND_AFTER_MINT=1). Failure here is
  // logged + swallowed — the mint is already on-chain, the user just won't
  // have starter USDC pre-funded. They can top up manually if needed.
  let prefund: Awaited<ReturnType<typeof prefundUserWallet>> | undefined
  try {
    prefund = await prefundUserWallet({ userId: user.id, wallet: user.wallet })
  } catch (e) {
    console.warn('[identity/confirm] prefund failed', e instanceof Error ? e.message : e)
  }

  return NextResponse.json({
    ok: true,
    tokenId,
    txHash: parsed.data.txHash,
    contract: IDENTITY_REGISTRY,
    standard: 'ERC-8004',
    role: 'client',
    onChain: true,
    userOwned: true,
    prefund: prefund ?? { enabled: false },
  })
}
