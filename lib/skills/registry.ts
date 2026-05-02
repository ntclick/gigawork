import { eq } from 'drizzle-orm'

import { db } from '@/lib/db/client'
import { withDbRetry } from '@/lib/db/retry'
import { skills, type Skill } from '@/lib/db/schema'

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

export async function callSkillEndpoint(
  skill: Skill,
  input: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(skill.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw new Error(`skill ${skill.name} failed: ${res.status} ${await res.text().catch(() => '')}`)
  }
  return res.json()
}
