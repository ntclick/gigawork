/**
 * POST /api/workflow/[id]/validation/reconcile
 *
 * Background reconciliation for ERC-8004 ValidationRegistry — picks up
 * any `validationRequest` the user broadcast for this workflow's agents
 * that haven't yet received a `validationResponse` from the admin
 * validator, and signs the response now.
 *
 * Why: the foreground POST /respond happens inline after the user
 * signs each request. If the user closes the tab between request and
 * response (or the fetch is aborted by a flaky network), the response
 * never fires — leaving the workflow stuck "request-only" on chain.
 *
 * Called on workflow page mount (when status=completed) so unfinished
 * validations resume automatically. Idempotent: if status.response is
 * already set, skip. Safe to call repeatedly.
 *
 * For workflows whose tokens admin owns, we'd already have run the
 * full request+response inside finalizeWorkflow.attestWorkflowCompletion;
 * this endpoint specifically catches the user-owned token path.
 */
import { NextResponse } from 'next/server'
import { encodeFunctionData, keccak256, parseAbi, toHex, type Hex } from 'viem'
import { eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import {
  adminAccount,
  pollingClient,
  sendAdminTransaction,
} from '@/lib/chain/client'
import { getValidationStatus } from '@/lib/chain/validation'
import { db } from '@/lib/db/client'
import { messages, nodes, skills, workflows } from '@/lib/db/schema'

const VALIDATION_REGISTRY = process.env.VALIDATION_REGISTRY_ADDRESS as
  | `0x${string}`
  | undefined

const validationAbi = parseAbi([
  'function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag) external',
])

const RESPONSE_PASSED = 100
const VALIDATION_TAG = 'workflow_completed'

interface ReconcileResult {
  agentId: string
  status: 'already_responded' | 'no_request_yet' | 'responded' | 'error'
  requestHash: Hex
  responseTx?: Hex
  error?: string
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!VALIDATION_REGISTRY || !adminAccount) {
    return NextResponse.json(
      { ok: true, results: [], reason: 'registry_or_admin_not_configured' },
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

  // Collect agentTokenIds touched by this workflow.
  const completed = await db
    .select({ agentTokenId: skills.agentTokenId })
    .from(nodes)
    .innerJoin(skills, eq(nodes.skillId, skills.id))
    .where(eq(nodes.workflowId, workflowId))
  const agentIds = [
    ...new Set(
      completed
        .map((r) => r.agentTokenId)
        .filter((v): v is string => !!v),
    ),
  ]

  const results: ReconcileResult[] = []
  for (const agentId of agentIds) {
    const requestHash = keccak256(
      toHex(`gw-validation:${workflowId}:agent:${agentId}`),
    )
    const status = await getValidationStatus(requestHash)
    if (!status) {
      // No request on-chain yet — user hasn't signed for this agent.
      results.push({ agentId, status: 'no_request_yet', requestHash })
      continue
    }
    // Already responded? response != 0 means a validator wrote it.
    if (
      status.response !== 0 &&
      status.validator.toLowerCase() === adminAccount.address.toLowerCase()
    ) {
      results.push({ agentId, status: 'already_responded', requestHash })
      continue
    }
    // Request is on-chain, no response yet — fire the response now.
    try {
      const data = encodeFunctionData({
        abi: validationAbi,
        functionName: 'validationResponse',
        args: [
          requestHash,
          RESPONSE_PASSED,
          '',
          requestHash, // responseHash mirrors requestHash for join-ability
          VALIDATION_TAG,
        ],
      })
      const hash = await sendAdminTransaction({
        to: VALIDATION_REGISTRY,
        data,
      })
      const receipt = await pollingClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 90_000,
        pollingInterval: 1_000,
      })
      if (receipt.status !== 'success') {
        results.push({
          agentId,
          status: 'error',
          requestHash,
          error: `response tx ${hash} reverted`,
        })
        continue
      }
      results.push({
        agentId,
        status: 'responded',
        requestHash,
        responseTx: hash,
      })

      // Persist trail message so the UI reflects the new state.
      try {
        await db.insert(messages).values({
          workflowId,
          role: 'system',
          toolName: 'validationAttest',
          toolPayload: {
            tx: hash,
            source: 'reconcile',
            attestations: [
              {
                agentId,
                requestTx: null,
                responseTx: hash,
                requestHash,
                passed: true,
                skipped: null,
              },
            ],
          },
          content: null,
        })
      } catch (err) {
        console.warn(
          '[validation/reconcile] persist message failed',
          err instanceof Error ? err.message : err,
        )
      }
    } catch (err) {
      results.push({
        agentId,
        status: 'error',
        requestHash,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ ok: true, results })
}
