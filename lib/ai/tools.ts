import { tool } from 'ai'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { ERC8183_ENABLED, settleJob } from '@/lib/chain/agenticCommerce'
import { signDispatchTx } from '@/lib/chain/dispatch'
import { chargeCredits, InsufficientCreditsError } from '@/lib/credits/service'
import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { messages, nodes, users, workflows } from '@/lib/db/schema'
import { callSkillEndpoint, getSkillByName } from '@/lib/skills/registry'

export type BrainContext = { workflowId: string; userId: string | null }

export function buildBrainTools(ctx: BrainContext) {
  const { workflowId, userId } = ctx

  const planWorkflow = tool({
    description:
      'Plan the workflow nodes from the user prompt. Call ONCE at the start. Each node has id (slug), label (human title), skill_name (must match a registered skill), and depends_on (array of node ids that must finish first).',
    inputSchema: z.object({
      nodes: z
        .array(
          z.object({
            id: z.string().min(1).describe('short slug, e.g. "scanner"'),
            label: z.string().min(1),
            skill_name: z.string().min(1),
            depends_on: z.array(z.string()).default([]),
          }),
        )
        .min(1),
    }),
    execute: async ({ nodes: planned }) => {
      // Block re-planning. If a plan exists, return its nodes so Kimi reads
      // the existing node_ids and proceeds to dispatch instead of looping.
      const priorPlan = await db
        .select({ id: messages.id, toolPayload: messages.toolPayload })
        .from(messages)
        .where(
          and(
            eq(messages.workflowId, workflowId),
            eq(messages.toolName, 'planWorkflow'),
          ),
        )
        .limit(1)
      if (priorPlan.length > 0) {
        const existingNodes = await db
          .select({ id: nodes.id, label: nodes.label, dependsOn: nodes.dependsOn })
          .from(nodes)
          .where(eq(nodes.workflowId, workflowId))
        return {
          ok: false,
          error: 'already_planned',
          message:
            'A plan already exists for this workflow. Do NOT re-plan. Call dispatchSkill on each existing node below, then finalizeReport.',
          existing_nodes: existingNodes,
        }
      }

      const skillRows = await db.query.skills.findMany()
      const byName = new Map(skillRows.map((s) => [s.name, s]))

      const rows = planned.map((p) => ({
        workflowId,
        kind: 'skill_call',
        label: p.label,
        skillId: byName.get(p.skill_name)?.id ?? null,
        status: 'pending',
        dependsOn: p.depends_on,
      }))

      const inserted = await db.insert(nodes).values(rows).returning()
      await db
        .update(workflows)
        .set({ status: 'running' })
        .where(eq(workflows.id, workflowId))

      const out = {
        nodes: inserted.map((n, i) => ({
          node_id: n.id,
          plan_id: planned[i].id,
          label: n.label,
          skill_name: planned[i].skill_name,
          depends_on: planned[i].depends_on,
        })),
      }

      // Persist for reload — without this row the canvas can't replay.
      await db.insert(messages).values({
        workflowId,
        role: 'system',
        toolName: 'planWorkflow',
        toolPayload: { input: { nodes: planned }, output: out },
        content: null,
      })

      return out
    },
  })

  const dispatchSkill = tool({
    description:
      'Call a skill endpoint with input. Use after the node\'s dependencies are completed. ' +
      '`input_json` MUST be a JSON-encoded string of the skill\'s input object — NOT an empty object. ' +
      'Examples by skill: ' +
      'crypto-scanner: \'{"token_address":"0xc02aaa...","chain":"ethereum"}\'. ' +
      'trading-signals: \'{"symbol":"ETH/USDT","timeframe":"4h","exchange":"binance"}\'. ' +
      'social-sentiment: \'{"topic":"Ethereum","window_hours":24,"channels":["reddit"]}\'. ' +
      'whale-tracker: \'{"wallet":"0x47ac...","network":"eth-mainnet","limit":25}\'. ' +
      'defi-yields: \'{"top_n":10,"min_tvl_usd":1000000,"stablecoin_only":false}\'. ' +
      'web-intel: \'{"query":"Ethereum upgrades 2026","max_results":5}\'. ' +
      'report-composer: \'{"data":{<plan_id>:<output>,...},"tone":"casual","format":"markdown"}\'.',
    inputSchema: z.object({
      // Accept UUID or plan_id slug (e.g. "polymarket-odds"). We resolve
      // slug→UUID server-side so Kimi can confidently use either form.
      node_id: z
        .string()
        .min(1)
        .describe('node_id from planWorkflow output (UUID) OR plan_id slug (e.g. "polymarket-odds")'),
      skill_name: z.string().min(1),
      input: z
        .record(z.string(), z.unknown())
        .describe(
          'Skill-specific arguments as a plain object. Example: {"token_address":"0xabc","chain":"ethereum"}. Extract from user prompt — NEVER pass {}.',
        )
        .optional(),
      // Legacy alternative — older prompts told Kimi to JSON.stringify the args.
      input_json: z.string().optional(),
    }),
    execute: async ({ node_id: rawNodeId, skill_name, input: rawInput, input_json }) => {
      // Resolve rawNodeId — Kimi may pass either the UUID or the plan_id slug.
      // If not a UUID, look up the most recent node with matching label or
      // skill_name in this workflow.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawNodeId)
      let node_id = rawNodeId
      if (!isUuid) {
        // Slug path: find a pending/running node in this workflow whose
        // skill matches `skill_name`. If multiple, pick the depth-0 one.
        const skillRow = await getSkillByName(skill_name)
        const candidates = skillRow
          ? await db
              .select({ id: nodes.id, dependsOn: nodes.dependsOn, status: nodes.status })
              .from(nodes)
              .where(and(eq(nodes.workflowId, workflowId), eq(nodes.skillId, skillRow.id)))
              .limit(20)
          : []
        const depth0 = candidates.filter((c) => !c.dependsOn || c.dependsOn.length === 0)
        const pending = depth0.filter((c) => c.status === 'pending')
        const pick = pending[0] ?? depth0[0] ?? candidates[0]
        if (pick) node_id = pick.id
      }
      // Accept either {input: {...}} or {input_json: '{"...":"..."}'} or both.
      let input: Record<string, unknown> = {}
      if (rawInput && typeof rawInput === 'object') {
        input = rawInput as Record<string, unknown>
      } else if (input_json) {
        try {
          const parsed = typeof input_json === 'string' ? JSON.parse(input_json) : input_json
          if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>
        } catch {
          /* leave as {} */
        }
      }
      const skill = await getSkillByName(skill_name)
      if (!skill) {
        await db
          .update(nodes)
          .set({ status: 'failed', output: { error: `unknown skill ${skill_name}` } })
          .where(eq(nodes.id, node_id))
        return { ok: false, error: `unknown skill ${skill_name}` }
      }

      // ─── Inject user profile for notification skills ─────────────
      // The brain never sees the user's email, chat_id, or bot_token.
      // We pull from users.notify_email / .telegram_chat_id / .telegram_bot_token
      // and inject right before the HTTP call. Explicit values in the
      // brain's input still win (so per-workflow overrides work).
      //
      // bot_token is sensitive — keep a separate `recordedInput` with
      // the token redacted before persisting to messages.tool_payload.
      if (userId && (skill_name === 'email-sender' || skill_name === 'telegram-sender')) {
        const [profile] = await db
          .select({
            notifyEmail: users.notifyEmail,
            emailApiKey: users.emailApiKey,
            emailFrom: users.emailFrom,
            telegramChatId: users.telegramChatId,
            telegramBotToken: users.telegramBotToken,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
        if (skill_name === 'email-sender') {
          if (!input.to && profile?.notifyEmail) input.to = profile.notifyEmail
          if (!input.api_key && profile?.emailApiKey) input.api_key = profile.emailApiKey
          if (!input.from && profile?.emailFrom) input.from = profile.emailFrom
        }
        if (skill_name === 'telegram-sender') {
          if (!input.chat_id && profile?.telegramChatId) {
            input.chat_id = profile.telegramChatId
          }
          if (!input.bot_token && profile?.telegramBotToken) {
            input.bot_token = profile.telegramBotToken
          }
        }
      }

      const manifest = (skill.manifest ?? {}) as Record<string, unknown>
      const cost = Math.max(0, Math.round((manifest.cost_credits as number) ?? 5))

      if (userId && cost > 0) {
        try {
          await chargeCredits({
            userId,
            amount: cost,
            reason: `dispatch:${skill_name}`,
            workflowId,
          })
        } catch (err) {
          if (err instanceof InsufficientCreditsError) {
            await db
              .update(nodes)
              .set({ status: 'failed', output: { error: 'insufficient_credits', need: cost, have: err.have } })
              .where(eq(nodes.id, node_id))
            return {
              ok: false,
              error: 'insufficient_credits',
              skill_name,
              need_credits: cost,
              have_credits: err.have,
              hint: 'Top up via the wallet button (1 USDC = 100 credits).',
            }
          }
          throw err
        }
      }

      await db.update(nodes).set({ status: 'running' }).where(eq(nodes.id, node_id))

      try {
        const output = (await callSkillEndpoint(skill, input)) as Record<string, unknown>

        // Best-effort on-chain receipt for ERC-8183 verification. Records
        // a self-tx with dispatch envelope encoded as calldata so any
        // observer can prove this dispatch happened. Falls back to null
        // when admin wallet is missing (dev) or RPC errors out.
        let identityTokenId: string | null = null
        if (userId) {
          const [u] = await db
            .select({ id: users.identityTokenId })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
          identityTokenId = u?.id ?? null
        }
        const dispatchTx = await signDispatchTx({
          workflowId,
          nodeId: node_id,
          skillName: skill_name,
          cost,
          identityTokenId,
        })

        await db
          .update(nodes)
          .set({ status: 'completed', output: { ...output, dispatch_tx: dispatchTx?.txHash ?? null } })
          .where(eq(nodes.id, node_id))

        // Redact sensitive fields before persisting to message log.
        // Otherwise bot_token / api_key would sit in messages.tool_payload
        // forever in clear text.
        const recordedInput: Record<string, unknown> = { ...input }
        const redactKeys = ['bot_token', 'api_key', 'authorization'] as const
        for (const k of redactKeys) {
          const v = recordedInput[k]
          if (typeof v === 'string' && v.length > 0) {
            recordedInput[k] = '••••' + v.slice(-4)
          }
        }

        await db.insert(messages).values({
          workflowId,
          role: 'system',
          nodeId: node_id,
          toolName: 'dispatchSkill',
          toolPayload: {
            skill_name,
            input: recordedInput,
            output,
            dispatch_tx: dispatchTx?.txHash ?? null,
          },
          content: null,
        })
        return {
          ok: true,
          node_id,
          skill_name,
          output,
          dispatch_tx: dispatchTx?.txHash ?? null,
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        await db
          .update(nodes)
          .set({ status: 'failed', output: { error } })
          .where(eq(nodes.id, node_id))
        // Persist failed dispatch as a message so debug-workflow shows it
        // and the brain sees clear evidence the skill was attempted.
        await db.insert(messages).values({
          workflowId,
          role: 'system',
          nodeId: node_id,
          toolName: 'dispatchSkill',
          toolPayload: { skill_name, input, error, ok: false },
          content: null,
        })
        return { ok: false, node_id, skill_name, error }
      }
    },
  })

  const finalizeReport = tool({
    description:
      'Compose the final report once all nodes have completed. summary_markdown is what the user sees; raw_json is the merged structured payload.',
    inputSchema: z.object({
      summary_markdown: z.string().min(1),
      raw_json: z.record(z.string(), z.unknown()).default({}),
    }),
    execute: async ({ summary_markdown, raw_json }) => {
      // Guardrail: refuse to finalize if no dispatchSkill ran yet. Kimi
      // sometimes plans → finalizes directly with a "data unavailable"
      // excuse, skipping the actual research step. We force at least one
      // dispatch to have happened by checking the messages table.
      const dispatched = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.workflowId, workflowId),
            eq(messages.toolName, 'dispatchSkill'),
          ),
        )
        .limit(1)

      if (dispatched.length === 0) {
        // Surface the actual planned nodes so Kimi knows exactly what to dispatch.
        const planned = await db
          .select({ id: nodes.id, label: nodes.label, dependsOn: nodes.dependsOn })
          .from(nodes)
          .where(eq(nodes.workflowId, workflowId))
          .limit(20)
        return {
          ok: false,
          error: 'must_dispatch_first',
          message:
            'You called planWorkflow but never called dispatchSkill. STOP planning and start dispatching. For EACH planned node below, call dispatchSkill(node_id, skill_name, input). Run depth-0 nodes first, then their dependents. After all skills run, THEN call finalizeReport.',
          planned_nodes: planned,
          example_call:
            'dispatchSkill({ node_id: "<uuid from planned_nodes>", skill_name: "polymarket-pulse", input: { query: "Iran warship", limit: 5 } })',
        }
      }

      await db.insert(messages).values({
        workflowId,
        role: 'brain',
        content: summary_markdown,
        toolName: 'finalizeReport',
        toolPayload: { raw_json },
      })
      await db
        .update(workflows)
        .set({ status: 'completed' })
        .where(eq(workflows.id, workflowId))

      // Settle the ERC-8183 job if it was opened on workflow create.
      // Background fire-and-forget — the report is already saved, the
      // settle txs only add the on-chain trail.
      if (ERC8183_ENABLED) {
        const [wf] = await db
          .select()
          .from(workflows)
          .where(eq(workflows.id, workflowId))
          .limit(1)
        if (wf?.erc8183JobId && !wf.erc8183CompleteTx) {
          try {
            const res = await settleJob({
              jobId: wf.erc8183JobId,
              deliverableSeed: `${workflowId}:${summary_markdown.slice(0, 256)}`,
              reasonSeed: 'workflow-completed',
            })
            if (res) {
              await db
                .update(workflows)
                .set({
                  erc8183SubmitTx: res.submitTx,
                  erc8183CompleteTx: res.completeTx,
                  erc8183DeliverableHash: res.deliverableHash,
                })
                .where(eq(workflows.id, workflowId))
            }
          } catch (e) {
            console.warn(
              '[finalizeReport] ERC-8183 settle failed',
              e instanceof Error ? e.message : e,
            )
          }
        }
      }

      return { ok: true }
    },
  })

  return { planWorkflow, dispatchSkill, finalizeReport }
}
