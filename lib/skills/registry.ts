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
 * the SKILLS map — avoiding Vercel function-to-function HTTP loopback,
 * which fails with "fetch failed" when a serverless function fetches its
 * own public URL. Unknown / external skills still fall back to HTTP.
 */
export async function callSkillEndpoint(
  skill: Skill,
  input: Record<string, unknown>,
): Promise<unknown> {
  const local = SKILLS[skill.name]
  if (local) {
    return local(input)
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(skill.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      throw new Error(`skill ${skill.name} failed: ${res.status} ${await res.text().catch(() => '')}`)
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}
