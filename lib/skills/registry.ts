import { eq } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { skills, users, agentLiveness, type Skill } from '@/lib/db/schema'
import { SKILLS } from '@/lib/skills/handlers'

export interface SkillWithLiveness extends Skill {
  livenessStatus?: string | null
  livenessCapacity?: number | null
  livenessUptime30d?: number | null
  consecutiveJobFailures?: number | null
  lastHeartbeatAt?: string | null
  agentAddress?: string | null
}

export async function listSkills(): Promise<SkillWithLiveness[]> {
  const rows = await withDbRetry(
    () =>
      db
        .select({
          skill: skills,
          liveness: agentLiveness,
          wallet: users.wallet,
        })
        .from(skills)
        .leftJoin(users, eq(skills.ownerId, users.id))
        .leftJoin(agentLiveness, eq(users.wallet, agentLiveness.agentAddress)),
    { label: 'listSkills' },
  )

  return rows.map((r) => ({
    ...r.skill,
    livenessStatus: r.liveness?.status ?? null,
    livenessCapacity: r.liveness?.capacity ?? null,
    livenessUptime30d: r.liveness?.uptime30dPct ?? null,
    consecutiveJobFailures: r.liveness?.consecutiveJobFailures ?? null,
    lastHeartbeatAt: r.liveness?.lastHeartbeatAt?.toISOString() ?? null,
    agentAddress: r.wallet ?? null,
  }))
}

export async function getSkillByName(name: string): Promise<SkillWithLiveness | null> {
  const [row] = await withDbRetry(
    () =>
      db
        .select({
          skill: skills,
          liveness: agentLiveness,
          wallet: users.wallet,
        })
        .from(skills)
        .leftJoin(users, eq(skills.ownerId, users.id))
        .leftJoin(agentLiveness, eq(users.wallet, agentLiveness.agentAddress))
        .where(eq(skills.name, name))
        .limit(1),
    { label: 'getSkillByName' },
  )
  if (!row) return null
  return {
    ...row.skill,
    livenessStatus: row.liveness?.status ?? null,
    livenessCapacity: row.liveness?.capacity ?? null,
    livenessUptime30d: row.liveness?.uptime30dPct ?? null,
    consecutiveJobFailures: row.liveness?.consecutiveJobFailures ?? null,
    lastHeartbeatAt: row.liveness?.lastHeartbeatAt?.toISOString() ?? null,
    agentAddress: row.wallet ?? null,
  }
}

/**
 * Invoke a skill. Skills bundled in this app are called in-process via
 * the SKILLS map (avoiding fetch loopbacks) ONLY if they are free.
 * Paid monetized skills must go through the HTTP route /api/agents/[name]
 * to enforce the x402 payment challenge boundary.
 */
export async function callSkillEndpoint(
  skill: Skill,
  input: Record<string, unknown>,
  opts?: { workflowId?: string; nodeId?: string; timeoutMs?: number },
): Promise<unknown> {
  const manifest = (skill.manifest ?? {}) as Record<string, unknown>
  const isPaid = (manifest.cost_credits as number | undefined ?? 0) > 0

  const local = SKILLS[skill.name]
  if (local && !isPaid) {
    return local(input)
  }

  const timeoutMs = opts?.timeoutMs ?? 8_000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (opts?.workflowId) {
      headers['X-Workflow-ID'] = opts.workflowId
    }
    if (opts?.nodeId) {
      headers['X-Node-ID'] = opts.nodeId
    }

    if (isPaid && opts?.workflowId && opts?.nodeId) {
      const { createPaymentHeader } = await import('@/lib/payments/paymentManifest')
      const paymentHeader = await createPaymentHeader({
        skillName: skill.name,
        workflowId: opts.workflowId,
        nodeId: opts.nodeId,
      })
      if (paymentHeader) {
        headers['X-Payment'] = paymentHeader
      }
    }

    const res = await fetch(skill.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: ctrl.signal,
    })

    // Handle 402 challenge response for paid skills if we didn't send a valid header initially
    if (res.status === 402 && isPaid) {
      const challengeBody = await res.json().catch(() => null)
      const challenge = challengeBody?.accepts?.[0]
      if (challenge) {
        const { createPaymentHeaderFromChallenge } = await import('@/lib/payments/paymentManifest')
        const paymentHeader = await createPaymentHeaderFromChallenge({
          challenge,
          skillName: skill.name,
        })
        if (paymentHeader) {
          headers['X-Payment'] = paymentHeader
          const res2 = await fetch(skill.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(input),
            signal: ctrl.signal,
          })
          if (res2.ok) {
            return res2.json()
          }
          throw new Error(`skill ${skill.name} failed after 402 retry: ${res2.status} ${await res2.text().catch(() => '')}`)
        }
      }
    }

    if (!res.ok) {
      throw new Error(`skill ${skill.name} failed: ${res.status} ${await res.text().catch(() => '')}`)
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}
