import { and, eq, sql } from 'drizzle-orm'

import { settleJob } from '@/lib/chain/agenticCommerce'
import { incrementReputationBatch } from '@/lib/chain/reputation'
import { attestWorkflowCompletion } from '@/lib/chain/validation'
import { db } from '@/lib/db/client'
import { messages, nodes, skills, users, workflows } from '@/lib/db/schema'
import { decryptProfileSecrets } from '@/lib/notifications/secrets'
import { curlFetchJSON } from '@/lib/skills/curlFetch'
import { emitWorkflowEvent } from '@/lib/workflow/events'


export async function publishFinalReport({
  workflowId,
  userId,
  finalMarkdown,
  rawJson = {},
  toolName,
}: {
  workflowId: string
  userId: string | null
  finalMarkdown: string
  rawJson?: Record<string, unknown>
  toolName: 'finalizeReport' | 'auto_finalize'
}): Promise<{ ok: true } | { ok: false; error: string; message: string }> {
  // Final safety check: ensure all nodes are terminal.
  const allNodes = await db
    .select({ status: nodes.status })
    .from(nodes)
    .where(eq(nodes.workflowId, workflowId))

  if (allNodes.length > 0) {
    const pending = allNodes.filter((n) => n.status === 'pending' || n.status === 'running')
    if (pending.length > 0) {
      return {
        ok: false,
        error: 'workflow_not_terminal',
        message: `Final report cannot be published because ${pending.length} nodes are still running.`,
      }
    }
  }
  const existingFinal = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.workflowId, workflowId),
        sql`${messages.toolName} in ('finalizeReport', 'auto_finalize')`,
      ),
    )
    .limit(1)

  const [wf] = await db
    .select({ status: workflows.status, erc8183CompleteTx: workflows.erc8183CompleteTx })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1)

  // Only return early if the workflow is already completed.
  // If it's settlement_failed, we want to allow retrying settlement.
  if (existingFinal.length > 0 && wf?.status === 'completed') {
    return { ok: true }
  }

  // If already have a complete on-chain tx, we can just mark completed and return.
  if (wf?.erc8183CompleteTx && existingFinal.length > 0) {
    await db.update(workflows).set({ status: 'completed' }).where(eq(workflows.id, workflowId))
    return { ok: true }
  }

  await emitWorkflowEvent({
    workflowId,
    type: 'workflow.finalizing',
    status: 'finalizing',
    message: 'Publishing final workflow report',
    payload: { toolName, rawJsonKeys: Object.keys(rawJson) },
  })

  await db.insert(messages).values({
    workflowId,
    role: 'brain',
    content: finalMarkdown,
    toolName,
    toolPayload: { raw_json: rawJson },
  })
  await db
    .update(workflows)
    .set({ status: 'completed' })
    .where(eq(workflows.id, workflowId))

  await emitWorkflowEvent({
    workflowId,
    type: 'workflow.finalized',
    status: 'completed',
    message: 'Final report published',
    payload: { toolName },
  })
  await emitWorkflowEvent({
    workflowId,
    type: 'workflow.completed',
    status: 'completed',
    message: 'Workflow completed',
    payload: { toolName },
  })

  // Enqueue and execute on-chain settlement directly.
  //
  // Awaited — not fire-and-forget. This function's caller
  // (executeWorkflowRun, invoked from the execute route's `after()`)
  // extends the Vercel invocation's lifetime only until the promise IT is
  // holding resolves. A bare `.catch()` here without `await` is a promise
  // this function itself abandons, so the outer `after()` has nothing to
  // wait for and can complete — and freeze the container — before
  // settlement actually runs. This was the exact bug already fixed one
  // layer up (setTimeout / void-promise not surviving serverless
  // freezes); it recurred here because this call was never fixed with it.
  // The `.catch()` is kept — a settlement failure must not crash
  // publishFinalReport — but now the failure is awaited, not abandoned.
  await settleWorkflowJob(workflowId, finalMarkdown).catch((err) => {
    console.warn('[publishFinalReport] Direct settleWorkflowJob warning:', err)
  })

  // ERC-8004 reputation, run directly for the same reason settlement is.
  //
  // Both are enqueued below as `chain_jobs`, but that queue is drained by
  // a separate `pnpm worker:chain` process. Settlement never depended on
  // it — it has the direct call above — whereas reputation had only the
  // queue entry. With no worker running, every completed run left its
  // feedback job unprocessed and the UI said "reputation has not been
  // written on-chain yet" forever, for the providers AND for the client.
  //
  // `cacheReputation` scores both sides of the hire in one batch: each
  // provider skill's agentTokenId plus the client's own identity token.
  // It is idempotent (it bails if a `reputationUpdate` message already
  // exists for the workflow), so the worker and the reconcile endpoint
  // remain safe backstops rather than double-writers.
  await cacheReputation(workflowId, userId).catch((err) => {
    console.warn('[publishFinalReport] Direct cacheReputation warning:', err)
  })

  const { enqueueWorkflowSettlementJobs } = await import('@/lib/chain/jobs')
  await enqueueWorkflowSettlementJobs(workflowId, finalMarkdown, userId)

  // Send a brief notification to user's saved Telegram bot upon successful
  // deployment (completion). Same fix, same reason — awaited so it
  // actually gets to run inside the extended `after()` lifetime rather
  // than racing a container freeze.
  await sendTelegramNotification(workflowId, userId, finalMarkdown).catch((e) => {
    console.error('[Telegram Notification] error', e)
  })

  return { ok: true }
}

async function sendTelegramNotification(workflowId: string, userId: string | null, finalMarkdown: string) {
  if (!userId) return
  try {
    const [row] = await db
      .select({
        telegramChatId: users.telegramChatId,
        telegramBotToken: users.telegramBotToken,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    // Bot token is encrypted at rest — see lib/notifications/secrets.ts.
    const u = decryptProfileSecrets(row)

    if (!u || !u.telegramBotToken) {
      console.log('[Telegram Notification] Skipped: No saved bot token found for user.')
      return
    }

    let chatId = u.telegramChatId?.trim() ?? ''
    const token = u.telegramBotToken.trim()

    // Extract bot ID from token (format: BOT_ID:SECRET).
    // If the saved chat_id equals the bot's own ID, the bot would try to
    // message itself which Telegram rejects with 403. Clear it to auto-detect.
    const botId = token.split(':')[0]
    if (botId && chatId === botId) {
      console.log(`[Telegram Notification] chat_id ${chatId} matches bot's own ID — clearing to auto-detect`)
      chatId = ''
    }

    // Auto-detect chat_id from getUpdates if not provided
    if (!chatId) {
      try {
        interface TelegramUpdate {
          message?: { chat?: { id?: number } }
          edited_message?: { chat?: { id?: number } }
          callback_query?: { message?: { chat?: { id?: number } } }
        }
        const updatesUrl = `https://api.telegram.org/bot${token}/getUpdates`
        const updatesRes = await curlFetchJSON<{ ok: boolean; result?: TelegramUpdate[] }>(updatesUrl, {
          method: 'GET',
          timeoutMs: 5000,
        })
        if (updatesRes.ok && Array.isArray(updatesRes.result) && updatesRes.result.length > 0) {
          const reversed = [...updatesRes.result].reverse()
          for (const item of reversed) {
            const cid = item.message?.chat?.id ?? item.edited_message?.chat?.id ?? item.callback_query?.message?.chat?.id
            if (cid) {
              chatId = String(cid)
              console.log(`[Telegram Notification] Auto-detected chat_id=${chatId} via getUpdates`)
              
              // Auto-save the detected chat_id back to user profile so we don't have to scan again
              try {
                await db.update(users).set({ telegramChatId: chatId }).where(eq(users.id, userId))
                console.log(`[Telegram Notification] Auto-saved detected chat_id=${chatId} to user profile`)
              } catch (dbErr) {
                console.error('[Telegram Notification] failed to auto-save detected chat_id', dbErr)
              }
              break
            }
          }
        }
      } catch (err) {
        console.warn('[Telegram Notification] Failed to auto-detect chat_id from getUpdates', err)
      }
    }

    if (!chatId) {
      console.log('[Telegram Notification] Skipped: No valid chat_id found or auto-detected.')
      return
    }

    const [wf] = await db
      .select({ prompt: workflows.prompt })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .limit(1)

    const title = wf?.prompt ? wf.prompt.slice(0, 100) + (wf.prompt.length > 100 ? '...' : '') : 'Workflow'
    
    // Clean up markdown syntax for a clean message
    let summaryText = finalMarkdown
      .replace(/[#*`_[\]()]/g, '') // strip markdown
      .replace(/\n+/g, ' ') // collapse newlines
      .trim()
    if (summaryText.length > 350) {
      summaryText = summaryText.slice(0, 350) + '...'
    }

    const message = 
      `🚀 *Hermes Deploy Successful!*\n\n` +
      `📌 *Workflow:* ${title}\n` +
      `🆔 *ID:* \`${workflowId}\`\n\n` +
      `📝 *Summary:*\n_${summaryText}_`

    const url = `https://api.telegram.org/bot${token}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    })
    
    if (!res.ok) {
      const errText = await res.text()
      console.warn(`[Telegram Notification] telegram API failed: ${errText}`)
    } else {
      console.log(`[Telegram Notification] Brief deploy report sent successfully for ${workflowId}`)
    }
  } catch (e) {
    console.warn('[Telegram Notification] failed (non-fatal)', e)
  }
}

export async function settleWorkflowJob(workflowId: string, finalMarkdown: string) {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1)

  if (wf?.erc8183CompleteTx) return true
  if (!wf?.erc8183JobId) {
    // No job was ever created — skip settlement.
    console.warn('[publishFinalReport] no ERC-8183 jobId — skipping settlement')
    return false
  }
  if (!wf.erc8183FundTx) {
    // Job created but never funded. Check on-chain status.
    // If it somehow got funded on-chain but DB missed the tx, settle anyway.
    try {
      const { readJobStatus } = await import('@/lib/chain/agenticCommerce')
      const onChainStatus = await readJobStatus(BigInt(wf.erc8183JobId))
      if (onChainStatus !== 1) {
        // 1 = Funded. Job is not in a settleable state.
        console.warn(`[publishFinalReport] job ${wf.erc8183JobId} not funded on-chain (status=${onChainStatus}), skipping settlement`)
        return false
      }
      console.warn(`[publishFinalReport] job ${wf.erc8183JobId} funded on-chain but DB missed fundTx — proceeding to settle`)
    } catch {
      console.warn('[publishFinalReport] could not check on-chain job status — skipping settlement')
      return false
    }
  }

  try {
    const res = await settleJob({
      jobId: wf.erc8183JobId,
      deliverableSeed: `${workflowId}:${finalMarkdown.slice(0, 256)}`,
      reasonSeed: 'workflow-completed',
      fundTx: wf.erc8183FundTx,
    })
    if (!res) return false
    await db
      .update(workflows)
      .set({
        erc8183SubmitTx: res.submitTx,
        erc8183CompleteTx: res.completeTx,
        erc8183DeliverableHash: res.deliverableHash,
      })
      .where(eq(workflows.id, workflowId))
    return true
  } catch (e) {
    console.warn('[publishFinalReport] ERC-8183 settle failed', e instanceof Error ? e.message : e)
    return false
  }
}

/**
 * Mark a workflow `failed` AND fire negative ERC-8004 reputation feedback
 * for the user + every skill that ran. Idempotent: callers may invoke
 * this from multiple error paths (brain.onError, onFinish without
 * tool-calls, persistIncompleteWorkflow) — the DB update is harmless on
 * a row already failed, and the reputation tx is gated on whether we've
 * already recorded a `reputationUpdate` message for this workflow.
 */
export async function failWorkflow(
  workflowId: string,
  userId: string | null,
): Promise<void> {
  await db
    .update(workflows)
    .set({ status: 'failed' })
    .where(eq(workflows.id, workflowId))

  await emitWorkflowEvent({
    workflowId,
    type: 'workflow.failed',
    status: 'failed',
    message: 'Workflow failed',
  })

  const { enqueueChainJob } = await import('@/lib/chain/jobs')
  await enqueueChainJob({
    workflowId,
    kind: 'erc8004_feedback',
    idempotencyKey: `erc8004_feedback:${workflowId}`,
    payload: { userId, outcome: 'failed' },
  })
}

export async function processFailedReputation(
  workflowId: string,
  userId: string | null,
): Promise<void> {
  const existing = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.workflowId, workflowId),
        eq(messages.toolName, 'reputationUpdate'),
      ),
    )
    .limit(1)
  if (existing.length > 0) return // already recorded — don't double-tax

  try {
    const completedRows = await db
      .select({ agentTokenId: skills.agentTokenId })
      .from(nodes)
      .innerJoin(skills, eq(nodes.skillId, skills.id))
      .where(eq(nodes.workflowId, workflowId))

    const [u] = userId
      ? await db
          .select({ identityTokenId: users.identityTokenId })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
      : []

    const tokenIds = [
      ...new Set(
        [
          ...completedRows.map((r) => r.agentTokenId),
          u?.identityTokenId,
        ].filter(Boolean),
      ),
    ] as string[]

    if (tokenIds.length === 0) {
      await db.insert(messages).values({
        workflowId,
        role: 'system',
        toolName: 'reputationUpdate',
        toolPayload: {
          tx: null,
          tokenIds: [],
          status: 'skipped',
          outcome: 'failed',
          reason: 'No on-chain identity tokens to penalise.',
        },
        content: null,
      })
      return
    }

    const repTx = await incrementReputationBatch(tokenIds, 'failed', workflowId)
    await db.insert(messages).values({
      workflowId,
      role: 'system',
      toolName: 'reputationUpdate',
      toolPayload: {
        tx: repTx,
        tokenIds,
        outcome: 'failed',
        status: repTx ? 'recorded' : 'skipped',
      },
      content: null,
    })
  } catch (e) {
    console.warn(
      '[failWorkflow] negative reputation failed (non-fatal)',
      e instanceof Error ? e.message : e,
    )
  }
}

/**
 * Has this workflow's reputation already been scored for real?
 *
 * The presence of a `reputationUpdate` message is the idempotency key, but
 * not every such row represents an attempt worth respecting: the offline
 * planner used to drop a `outcome: 'simulated'` placeholder at planning
 * time, and older rows recorded `status: 'skipped'` when the registry was
 * unconfigured. Treating those as "done" is what left runs permanently
 * unscored. Only a row carrying a tx, or a genuine completed/failed
 * outcome, counts — so a retry can still get through.
 */
export async function reputationAlreadySettled(workflowId: string): Promise<boolean> {
  const rows = await db
    .select({ payload: messages.toolPayload })
    .from(messages)
    .where(
      and(eq(messages.workflowId, workflowId), eq(messages.toolName, 'reputationUpdate')),
    )

  return rows.some((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>
    if (p.tx) return true
    return p.outcome === 'completed' || p.outcome === 'failed'
  })
}

export async function cacheReputation(workflowId: string, userId: string | null) {
  if (await reputationAlreadySettled(workflowId)) return

  try {
    // Count completed skills (with or without on-chain agentTokenId)
    const allCompletedSkills = await db
      .select({ skillId: skills.id, agentTokenId: skills.agentTokenId })
      .from(nodes)
      .innerJoin(skills, eq(nodes.skillId, skills.id))
      .where(
        and(
          eq(nodes.workflowId, workflowId),
          eq(nodes.status, 'completed'),
        ),
      )

    const skillsWithToken = allCompletedSkills.filter((r) => !!r.agentTokenId)

    const [u] = userId
      ? await db
          .select({ identityTokenId: users.identityTokenId })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
      : []

    const tokenIds = [
      ...new Set(
        [
          ...skillsWithToken.map((r) => r.agentTokenId!),
          u?.identityTokenId,
        ].filter(Boolean),
      ),
    ] as string[]

    // Always cache DB reputation for completed skills, even when
    // on-chain increment is unavailable.
    const uniqueSkillIds = [...new Set(allCompletedSkills.map((row) => row.skillId))]
    for (const skillId of uniqueSkillIds) {
      await db
        .update(skills)
        .set({ reputationScore: sql`reputation_score + 1` })
        .where(eq(skills.id, skillId))
    }

    if (userId) {
      await db
        .update(users)
        .set({ reputationScore: sql`reputation_score + 1` })
        .where(eq(users.id, userId))
    }

    // Attempt on-chain reputation increment
    if (tokenIds.length === 0) {
      await db.insert(messages).values({
        workflowId,
        role: 'system',
        toolName: 'reputationUpdate',
        toolPayload: {
          tx: null,
          tokenIds: [],
          status: 'skipped',
          reason: 'No on-chain identity tokens found for user or skills. DB reputation was still incremented.',
        },
        content: null,
      })
      return
    }

    const repTx = await incrementReputationBatch(tokenIds, 'completed', workflowId)
    if (!repTx) {
      // Registry not configured or admin wallet missing — record so
      // UI shows a clear status instead of "pending" forever.
      await db.insert(messages).values({
        workflowId,
        role: 'system',
        toolName: 'reputationUpdate',
        toolPayload: {
          tx: null,
          tokenIds,
          status: 'skipped',
          reason: 'REPUTATION_REGISTRY_ADDRESS not configured or admin wallet missing. DB reputation was still incremented.',
        },
        content: null,
      })
      return
    }

    // Persist to workflows row so API returns it in erc8183 trail
    await db
      .update(workflows)
      .set({ erc8183ReputationTx: repTx })
      .where(eq(workflows.id, workflowId))

    await db.insert(messages).values({
      workflowId,
      role: 'system',
      toolName: 'reputationUpdate',
      toolPayload: { tx: repTx, tokenIds },
      content: null,
    })

    // ── ERC-8004 ValidationRegistry attestation ("Agent Proofs") ───
    // Runs AFTER reputation so a failure here doesn't roll back the
    // reputation tx. Best-effort: validation registry is ownership-
    // gated, and any token not owned by the admin signer is skipped
    // with a reason. We record per-agent request/response tx hashes
    // so the trail UI can render "proof recorded" vs "owner-mismatch
    // skipped" instead of a generic "pending".
    try {
      const attestations = await attestWorkflowCompletion(workflowId, tokenIds)
      const recordedTx =
        attestations.find((a) => a.responseTx)?.responseTx ?? null
      await db.insert(messages).values({
        workflowId,
        role: 'system',
        toolName: 'validationAttest',
        toolPayload: {
          tx: recordedTx,
          attestations: attestations.map((a) => ({
            agentId: a.agentId,
            requestTx: a.requestTx,
            responseTx: a.responseTx,
            requestHash: a.requestHash,
            passed: a.passed,
            skipped: a.skipped ?? null,
          })),
        },
        content: null,
      })
    } catch (vErr) {
      console.warn(
        '[publishFinalReport] validation attestation failed (non-fatal)',
        vErr instanceof Error ? vErr.message : vErr,
      )
      await db.insert(messages).values({
        workflowId,
        role: 'system',
        toolName: 'validationAttest',
        toolPayload: {
          tx: null,
          status: 'error',
          reason: vErr instanceof Error ? vErr.message : String(vErr),
        },
        content: null,
      })
    }
  } catch (e) {
    console.warn('[publishFinalReport] reputation update failed (non-fatal)', e instanceof Error ? e.message : e)
    // Record the failure so UI can show error state
    try {
      await db.insert(messages).values({
        workflowId,
        role: 'system',
        toolName: 'reputationUpdate',
        toolPayload: {
          tx: null,
          status: 'error',
          reason: e instanceof Error ? e.message : String(e),
        },
        content: null,
      })
    } catch { /* double-fault — ignore */ }
  }
}
