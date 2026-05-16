import { and, eq, sql } from 'drizzle-orm'

import { ERC8183_ENABLED, settleJob } from '@/lib/chain/agenticCommerce'
import { incrementReputationBatch } from '@/lib/chain/reputation'
import { attestWorkflowCompletion } from '@/lib/chain/validation'
import { db } from '@/lib/db/client'
import { messages, nodes, skills, users, workflows } from '@/lib/db/schema'

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

  await db
    .update(workflows)
    .set({ status: ERC8183_ENABLED ? 'settling' : 'completed' })
    .where(eq(workflows.id, workflowId))

  if (ERC8183_ENABLED) {
    // Settlement is best-effort — if it fails (e.g. job was never funded,
    // or RPC times out) we still save the report and mark completed.
    // The settlement trail in the UI will show the failure reason.
    const settled = await settleWorkflowJob(workflowId, finalMarkdown)
    if (settled) {
      await cacheReputation(workflowId, userId)
    } else {
      // Record why settlement was skipped but do NOT block the report.
      console.warn('[publishFinalReport] settlement skipped — still publishing report')
    }
  }

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

  return { ok: true }
}

async function settleWorkflowJob(workflowId: string, finalMarkdown: string) {
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

    const repTx = await incrementReputationBatch(tokenIds, 'failed')
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

async function cacheReputation(workflowId: string, userId: string | null) {
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

    const repTx = await incrementReputationBatch(tokenIds)
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
