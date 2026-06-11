import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { decodeFunctionData, parseAbi, type Hex } from 'viem'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { workflows, nodes, skills, workflowEvents } from '@/lib/db/schema'
import { buildWorkflowViewState } from '@/lib/workflow/view-state'
import { readJobStatus, ERC8183_CONTRACT } from '@/lib/chain/agenticCommerce'
import { publicClient } from '@/lib/chain/client'

export const dynamic = 'force-dynamic'

const SELF_HEAL_MAX_BLOCK_SCAN = 50n

const settleAbi = parseAbi([
  'function submit(uint256 jobId, bytes32 deliverable, bytes optParams)',
  'function complete(uint256 jobId, bytes32 reason, bytes optParams)',
])

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params

  let u
  try {
    u = await getCurrentUser()
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw e
  }

  const [wf] = await withDbRetry(
    () => db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, u.id)))
      .limit(1),
    { label: 'workflow-view-state:wf' },
  )

  if (!wf) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Self-heal: If EIP-8183 job is active but completeTx is missing in DB
  if (wf.erc8183JobId && !wf.erc8183CompleteTx && wf.erc8183FundTx) {
    try {
      const jobId = BigInt(wf.erc8183JobId)
      const onChainStatus = await readJobStatus(jobId)
      if (onChainStatus === 3) {
        const fundTx = wf.erc8183FundTx as Hex
        const latestBlock = await publicClient.getBlockNumber()

        let fromBlock = 0n
        try {
          const fundReceipt = await publicClient.getTransactionReceipt({ hash: fundTx })
          fromBlock = fundReceipt.blockNumber
        } catch {
          fromBlock = latestBlock > 200n ? latestBlock - 200n : 0n
        }

        let submitTx: Hex | null = null
        let completeTx: Hex | null = null
        let deliverableHash: Hex | null = null

        // Scan a small bounded window for quick on-demand self-heal. Larger
        // reconciliation should happen in background jobs, not GET refreshes.
        const toBlock = latestBlock < fromBlock + SELF_HEAL_MAX_BLOCK_SCAN
          ? latestBlock
          : fromBlock + SELF_HEAL_MAX_BLOCK_SCAN
        for (let b = fromBlock; b <= toBlock; b++) {
          try {
            const block = await publicClient.getBlock({ blockNumber: b, includeTransactions: true })
            for (const tx of block.transactions) {
              if (tx.to?.toLowerCase() !== ERC8183_CONTRACT.toLowerCase()) continue
              try {
                const decoded = decodeFunctionData({ abi: settleAbi, data: tx.input })
                if (decoded.args[0] === jobId) {
                  if (decoded.functionName === 'submit') {
                    submitTx = tx.hash
                    deliverableHash = decoded.args[1]
                  }
                  if (decoded.functionName === 'complete') {
                    completeTx = tx.hash
                  }
                }
              } catch {
                // ignore
              }
            }
          } catch {
            // ignore block error
          }
          if (submitTx && completeTx) break
        }

        if (submitTx && completeTx) {
          await db
            .update(workflows)
            .set({
              erc8183SubmitTx: submitTx,
              erc8183CompleteTx: completeTx,
              erc8183DeliverableHash: deliverableHash,
              status: 'completed',
            })
            .where(eq(workflows.id, id))

          // Update local mutable object for immediate response
          wf.erc8183SubmitTx = submitTx
          wf.erc8183CompleteTx = completeTx
          wf.erc8183DeliverableHash = deliverableHash
          wf.status = 'completed'
          console.log(`[Self-Heal] Successfully synced EIP-8183 settlement in view-state for job #${jobId}`)
        }
      }
    } catch (err) {
      console.warn('[Self-Heal] on-demand sync failed in view-state', err)
    }
  }

  const [steps, agents, events] = await Promise.all([
    withDbRetry(
      () => db
        .select()
        .from(nodes)
        .where(eq(nodes.workflowId, id))
        .orderBy(asc(nodes.createdAt)),
      { label: 'workflow-view-state:steps' }
    ),
    withDbRetry(
      () => db.select().from(skills),
      { label: 'workflow-view-state:agents' }
    ),
    withDbRetry(
      () => db
        .select()
        .from(workflowEvents)
        .where(eq(workflowEvents.workflowId, id))
        .orderBy(asc(workflowEvents.createdAt)),
      { label: 'workflow-view-state:events' }
    ),
  ])

  const viewState = buildWorkflowViewState(wf, steps, [], agents, events)

  return NextResponse.json(viewState)
}
