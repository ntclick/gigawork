import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'

import { AuthRequiredError, getCurrentUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { messages, workflows } from '@/lib/db/schema'

import { readJobStatus, ERC8183_CONTRACT } from '@/lib/chain/agenticCommerce'
import { publicClient } from '@/lib/chain/client'
import { decodeFunctionData, parseAbi, type Hex } from 'viem'

const settleAbi = parseAbi([
  'function submit(uint256 jobId, bytes32 deliverable, bytes optParams)',
  'function complete(uint256 jobId, bytes32 reason, bytes optParams)',
])

type RouteCtx = { params: Promise<{ id: string }> }

// `createdAt` is the real persisted row timestamp. The terminal console
// orders its log strictly by these — without them it had to stamp lines
// with the time it happened to fetch, which pushed a replayed run's
// prompt and plan to the BOTTOM of the log, after events that really
// happened hours earlier.
type ToolPart = {
  type: string
  toolCallId: string
  state: 'output-available'
  input: unknown
  output: unknown
  createdAt: string
}

type TextPart = { type: 'text'; text: string; createdAt: string }

type UIMessageOut = {
  id: string
  role: 'user' | 'assistant'
  createdAt: string
  parts: (ToolPart | TextPart)[]
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params

  const [[wf], rows] = await Promise.all([
    withDbRetry(
      () => db
        .select()
        .from(workflows)
        .where(eq(workflows.id, id))
        .limit(1),
      { label: 'workflow-messages:wf' },
    ),
    withDbRetry(
      () => db
        .select()
        .from(messages)
        .where(eq(messages.workflowId, id))
        .orderBy(asc(messages.createdAt)),
      { label: 'workflow-messages:rows' },
    )
  ])

  if (!wf) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Non-blocking Self-heal: If EIP-8183 job is active but completeTx is missing in DB
  if (wf.erc8183JobId && !wf.erc8183CompleteTx && wf.erc8183FundTx) {
    try {
      const jobId = BigInt(wf.erc8183JobId)
      const onChainStatus = await Promise.race([
        readJobStatus(jobId),
        new Promise<number>((r) => setTimeout(() => r(-1), 1000)),
      ])
      if (onChainStatus === 3) {
        // Fast-path status update so the response returns in < 15ms
        if (wf.status !== 'completed') {
          wf.status = 'completed'
          db.update(workflows)
            .set({ status: 'completed' })
            .where(eq(workflows.id, id))
            .catch(() => {})
        }
        // Run deep block scan asynchronously in background without blocking response
        setTimeout(async () => {
          try {
            const fundTx = wf.erc8183FundTx as Hex
            const latestBlock = await publicClient.getBlockNumber()
            let fromBlock = 0n
            try {
              const fundReceipt = await publicClient.getTransactionReceipt({ hash: fundTx })
              fromBlock = fundReceipt.blockNumber
            } catch {
              fromBlock = latestBlock > 50n ? latestBlock - 50n : 0n
            }
            let submitTx: Hex | null = null
            let completeTx: Hex | null = null
            let deliverableHash: Hex | null = null
            const toBlock = latestBlock < fromBlock + 50n ? latestBlock : fromBlock + 50n
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
                  } catch {}
                }
              } catch {}
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
            }
          } catch (e) {
            console.warn('[Self-Heal Background] failed', e)
          }
        }, 0)
      }
    } catch (err) {
      console.warn('[Self-Heal] fast check skipped', err)
    }
  }

  const hasErc8183Trail = !!(
    wf.erc8183JobId ||
    wf.erc8183CreateTx ||
    wf.erc8183SetBudgetTx ||
    wf.erc8183ApproveTx ||
    wf.erc8183FundTx ||
    wf.erc8183SubmitTx ||
    wf.erc8183CompleteTx ||
    wf.erc8183ReputationTx
  )

  const out: UIMessageOut[] = []

  // First user bubble = workflow.prompt (the seed insert in /api/workflow lives
  // here, but we always synthesize from wf.prompt to be safe).
  const seedAt = (rows.find((m) => m.role === 'user')?.createdAt ?? wf.createdAt).toISOString()
  out.push({
    id: 'u-seed',
    role: 'user',
    createdAt: seedAt,
    parts: [{ type: 'text', text: wf.prompt, createdAt: seedAt }],
  })

  // Assistant message bundles every tool/text artifact in chronological order.
  const assistantParts: (ToolPart | TextPart)[] = []
  for (const m of rows) {
    if (m.role === 'user') continue // already seeded above
    if (m.role === 'system' && m.toolName) {
      const payload = (m.toolPayload as { input?: unknown; output?: unknown; skill_name?: string; output_data?: unknown } | null) ?? {}
      let input: unknown
      let output: unknown
      if (m.toolName === 'planWorkflow') {
        input = payload.input
        output = payload.output
      } else if (m.toolName === 'dispatchSkill') {
        const p = payload as {
          skill_name?: string
          input?: unknown
          output?: unknown
          dispatch_tx?: string | null
          ok?: boolean
          error?: string
        }
        input = { skill_name: p.skill_name, input: p.input, node_id: m.nodeId }
        const ok = p.ok === false ? false : !p.error
        output = {
          ok,
          node_id: m.nodeId,
          skill_name: p.skill_name,
          output: p.output,
          error: p.error,
          dispatch_tx: p.dispatch_tx ?? null,
        }
      } else {
        input = payload
        output = payload
      }
      assistantParts.push({
        type: `tool-${m.toolName}`,
        toolCallId: m.id,
        state: 'output-available',
        input,
        output,
        createdAt: m.createdAt.toISOString(),
      })
      continue
    }
    if (m.role === 'brain' && m.content) {
      if (m.toolName === 'stream_error') {
        assistantParts.push({
          type: 'tool-stream_error',
          toolCallId: m.id,
          state: 'output-available',
          input: {},
          output: { error: m.content },
          createdAt: m.createdAt.toISOString(),
        })
        continue
      }
      if (m.toolName === 'auto_finalize' && m.content.trimStart().startsWith('▸ Planning workflow')) {
        continue
      }
      assistantParts.push({ type: 'text', text: m.content, createdAt: m.createdAt.toISOString() })
      continue
    }
  }

  if (assistantParts.length > 0) {
    out.push({
      id: 'a-history',
      role: 'assistant',
      createdAt: assistantParts[0].createdAt,
      parts: assistantParts,
    })
  }

  return NextResponse.json({
    workflow: {
      id: wf.id,
      prompt: wf.prompt,
      status: wf.status,
      createdAt: wf.createdAt,
      erc8183: hasErc8183Trail
        ? {
            jobId: wf.erc8183JobId,
            createTx: wf.erc8183CreateTx,
            setBudgetTx: wf.erc8183SetBudgetTx,
            approveTx: wf.erc8183ApproveTx,
            fundTx: wf.erc8183FundTx,
            submitTx: wf.erc8183SubmitTx,
            completeTx: wf.erc8183CompleteTx,
            deliverableHash: wf.erc8183DeliverableHash,
            budgetUsdc: wf.erc8183BudgetUsdc,
            reputationTx: wf.erc8183ReputationTx,
          }
        : null,
    },
    messages: out,
    isFinished: ['completed', 'failed', 'refused', 'settlement_failed', 'settling'].includes(wf.status ?? ''),
  })
}
