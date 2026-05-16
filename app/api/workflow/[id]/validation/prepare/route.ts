/**
 * POST /api/workflow/[id]/validation/prepare
 *
 * Per ERC-8004, `validationRequest` is ownership-gated — only the
 * agentId's owner can request validation. In our flow skill agent NFTs
 * are owned by the user who registered them, so this endpoint returns
 * one calldata per agentId the calling user owns. The frontend signs
 * each tx (user popup), then POSTs the hash to /respond where the
 * admin (acting as validator) signs `validationResponse`.
 *
 * Idempotent: if a validationRequest is already on-chain for the
 * computed requestHash (we detect via getValidationStatus), the entry
 * is omitted so the UI can move straight to the response step.
 */
import { NextResponse } from 'next/server'
import { encodeFunctionData, getAddress, keccak256, parseAbi, toHex } from 'viem'
import { eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { adminAccount, publicClient } from '@/lib/chain/client'
import { db } from '@/lib/db/client'
import { nodes, skills, workflows } from '@/lib/db/schema'
import { getValidationStatus } from '@/lib/chain/validation'

const VALIDATION_REGISTRY = process.env.VALIDATION_REGISTRY_ADDRESS as
  | `0x${string}`
  | undefined
const IDENTITY_REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS ??
  process.env.NEXT_PUBLIC_IDENTITY_REGISTRY) as `0x${string}` | undefined

const validationAbi = parseAbi([
  'function validationRequest(address validator, uint256 agentId, string requestURI, bytes32 requestHash) external',
])
const identityAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
])

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!VALIDATION_REGISTRY) {
    return NextResponse.json(
      { error: 'validation_registry_not_configured' },
      { status: 503 },
    )
  }
  if (!adminAccount) {
    return NextResponse.json(
      { error: 'admin_not_configured' },
      { status: 503 },
    )
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

  const { id: workflowId } = await ctx.params
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1)
  if (!wf) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (wf.userId !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Collect candidate agentIds: every completed skill's agentTokenId +
  // the user's identityTokenId. Self-vouching (user owns identity) is
  // skipped — only meaningful when a different party validates.
  const completedSkills = await db
    .select({ skillId: skills.id, agentTokenId: skills.agentTokenId })
    .from(nodes)
    .innerJoin(skills, eq(nodes.skillId, skills.id))
    .where(eq(nodes.workflowId, workflowId))
  const candidateIds = [
    ...new Set(
      completedSkills
        .map((r) => r.agentTokenId)
        .filter((v): v is string => !!v),
    ),
  ]

  const userAddrLower = getAddress(user.wallet).toLowerCase()
  const adminAddr = getAddress(adminAccount.address)

  // Filter: keep only tokens the calling user actually owns on-chain.
  // Anything else either (a) doesn't exist, (b) is owned by admin
  // (handled server-side already), or (c) is owned by a 3rd party we
  // can't act for.
  const items: Array<{
    agentId: string
    skillId: string | null
    calldata: `0x${string}`
    requestHash: `0x${string}`
    already: boolean
  }> = []

  for (const agentId of candidateIds) {
    let owner: string
    try {
      owner = (
        (await publicClient.readContract({
          address: IDENTITY_REGISTRY!,
          abi: identityAbi,
          functionName: 'ownerOf',
          args: [BigInt(agentId)],
        })) as `0x${string}`
      ).toLowerCase()
    } catch {
      continue
    }
    if (owner !== userAddrLower) continue

    const requestHash = keccak256(
      toHex(`gw-validation:${workflowId}:agent:${agentId}`),
    )
    // If the request is already on-chain, mark so the frontend can skip
    // signing and just trigger /respond.
    const existing = await getValidationStatus(requestHash)
    const already = !!existing
    const calldata = encodeFunctionData({
      abi: validationAbi,
      functionName: 'validationRequest',
      args: [adminAddr, BigInt(agentId), '', requestHash],
    })
    const skillRow = completedSkills.find((s) => s.agentTokenId === agentId)
    items.push({
      agentId,
      skillId: skillRow?.skillId ?? null,
      calldata,
      requestHash,
      already,
    })
  }

  return NextResponse.json({
    ok: true,
    contract: VALIDATION_REGISTRY,
    items,
    workflowId,
  })
}
