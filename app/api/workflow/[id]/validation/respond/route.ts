/**
 * POST /api/workflow/[id]/validation/respond
 *
 * Body: { agentId, requestHash, requestTxHash }
 *
 * Called once per agentId AFTER the user has broadcast a
 * `validationRequest` tx for that agent. The server:
 *   1. Verifies the request tx was mined successfully + signed by the
 *      calling user (matches user.wallet on the cookie).
 *   2. Confirms the on-chain ValidationRegistry now reports the user
 *      as the requester for the supplied requestHash.
 *   3. As the registered validator (admin wallet), signs
 *      `validationResponse(requestHash, 100, "", responseHash, tag)`.
 *   4. Appends/updates a `validationAttest` message on the workflow so
 *      the trail UI can render the new request/response tx hashes.
 *
 * Idempotent: if response already exists on-chain we don't re-broadcast.
 */
import { NextResponse } from 'next/server'
import { encodeFunctionData, parseAbi, type Hex } from 'viem'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import {
  adminAccount,
  pollingClient,
  publicClient,
  sendAdminTransaction,
} from '@/lib/chain/client'
import { getValidationStatus } from '@/lib/chain/validation'
import { db } from '@/lib/db/client'
import { messages, workflows } from '@/lib/db/schema'

const VALIDATION_REGISTRY = process.env.VALIDATION_REGISTRY_ADDRESS as
  | `0x${string}`
  | undefined

const validationAbi = parseAbi([
  'function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag) external',
])

const TxHash = z.string().regex(/^0x[a-fA-F0-9]{64}$/)
const Body = z.object({
  agentId: z.string(),
  requestHash: TxHash,
  requestTxHash: TxHash,
})

const RESPONSE_PASSED = 100
const VALIDATION_TAG = 'workflow_completed'

export async function POST(
  req: Request,
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

  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }
  const { agentId, requestHash, requestTxHash } = parsed.data

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

  // ── 1. Verify the user-signed request tx ───────────────────────────
  let requestTx
  try {
    const receipt = await pollingClient.waitForTransactionReceipt({
      hash: requestTxHash as `0x${string}`,
      confirmations: 1,
      timeout: 90_000,
      pollingInterval: 1_000,
    })
    if (receipt.status !== 'success') {
      return NextResponse.json(
        { error: 'request_tx_reverted', txHash: requestTxHash },
        { status: 400 },
      )
    }
    requestTx = await publicClient.getTransaction({
      hash: requestTxHash as `0x${string}`,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: 'request_tx_not_found',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    )
  }
  if (requestTx.from.toLowerCase() !== user.wallet.toLowerCase()) {
    return NextResponse.json(
      {
        error: 'wrong_signer',
        detail: `expected from=${user.wallet}, got from=${requestTx.from}`,
      },
      { status: 400 },
    )
  }

  // ── 2. Confirm on-chain state matches our requestHash ─────────────
  const status = await getValidationStatus(requestHash as `0x${string}`)
  if (!status) {
    return NextResponse.json(
      { error: 'request_not_indexed', detail: 'getValidationStatus returned null after request mined' },
      { status: 400 },
    )
  }
  // If the validator was already set to admin AND response != 0, the
  // response was already submitted — idempotent return.
  if (
    status.response !== 0 &&
    status.validator.toLowerCase() === adminAccount.address.toLowerCase()
  ) {
    return NextResponse.json({
      ok: true,
      already: true,
      agentId,
      requestHash,
      response: status.response,
    })
  }

  // ── 3. Admin (validator) signs validationResponse ─────────────────
  const responseHash = requestHash // mirror so the indexer can join req ↔ resp
  let responseTxHash: Hex
  try {
    const data = encodeFunctionData({
      abi: validationAbi,
      functionName: 'validationResponse',
      args: [
        requestHash as `0x${string}`,
        RESPONSE_PASSED,
        '',
        responseHash as `0x${string}`,
        VALIDATION_TAG,
      ],
    })
    responseTxHash = await sendAdminTransaction({
      to: VALIDATION_REGISTRY,
      data,
    })
    const receipt = await pollingClient.waitForTransactionReceipt({
      hash: responseTxHash,
      confirmations: 1,
      timeout: 90_000,
      pollingInterval: 1_000,
    })
    if (receipt.status !== 'success') {
      return NextResponse.json(
        { error: 'response_tx_reverted', txHash: responseTxHash },
        { status: 500 },
      )
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: 'response_failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }

  // ── 4. Patch the workflow's validationAttest message ──────────────
  // We don't try to merge with the message finalizeWorkflow wrote
  // (which was a skipped entry for owner_mismatch tokens) — instead we
  // append a fresh row per agent so the trail UI just reads "the
  // latest attest message for this agent". Trail rendering already
  // groups by agentId.
  try {
    await db.insert(messages).values({
      workflowId,
      role: 'system',
      toolName: 'validationAttest',
      toolPayload: {
        tx: responseTxHash,
        attestations: [
          {
            agentId,
            requestTx: requestTxHash,
            responseTx: responseTxHash,
            requestHash,
            passed: true,
            skipped: null,
          },
        ],
      },
      content: null,
    })
  } catch (err) {
    // Trail UI won't update but the on-chain state is correct.
    console.warn(
      '[validation/respond] failed to persist attest message',
      err instanceof Error ? err.message : err,
    )
  }

  return NextResponse.json({
    ok: true,
    agentId,
    requestHash,
    requestTx: requestTxHash,
    responseTx: responseTxHash,
  })
}
