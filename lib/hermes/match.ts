import { db } from '@/lib/db/client'
import { agents } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export type AgentSelect = typeof agents.$inferSelect

/**
 * Shortlists and ranks active provider agents based on matching capability and minimum reputation score.
 */
export async function matchAgent(
  capability: string,
  minReputation: number = 0
): Promise<AgentSelect[]> {
  // Query all active provider agents
  const allProviders = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.agentType, 'provider'),
        eq(agents.isActive, true)
      )
    )

  // Filter by capability (case-insensitive) and reputation threshold
  const matched = allProviders.filter((agent) => {
    const caps = agent.capabilities || []
    const hasCap = caps.some((cap) => cap.toLowerCase().trim() === capability.toLowerCase().trim())
    const score = Number(agent.reputationScore || '0')
    return hasCap && score >= minReputation
  })

  // Sort by reputation score in descending order
  return matched.sort((a, b) => Number(b.reputationScore || '0') - Number(a.reputationScore || '0'))
}
