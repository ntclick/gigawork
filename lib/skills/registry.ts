import { eq } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { skills, type Skill } from '@/lib/db/schema'
import { SKILLS } from '@/lib/skills/handlers'

export async function listSkills(): Promise<Skill[]> {
  return withDbRetry(() => db.select().from(skills), { label: 'listSkills' })
}

export async function getSkillByName(name: string): Promise<Skill | null> {
  const [row] = await withDbRetry(
    () => db.select().from(skills).where(eq(skills.name, name)).limit(1),
    { label: 'getSkillByName' },
  )
  return row ?? null
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
  opts?: { workflowId?: string; nodeId?: string },
): Promise<unknown> {
  const manifest = (skill.manifest ?? {}) as Record<string, unknown>
  const isPaid = (manifest.cost_credits as number | undefined ?? 0) > 0

  const local = SKILLS[skill.name]
  if (local && !isPaid) {
    return local(input)
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
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
