import { db } from '@/lib/db/client'
import { agents } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { encryptSecretIfNeeded } from '@/lib/crypto/walletEncryption'

export type AgentInsert = typeof agents.$inferInsert
export type AgentSelect = typeof agents.$inferSelect

/**
 * Fetch an agent by their UUID.
 */
export async function getAgentById(id: string): Promise<AgentSelect | null> {
  const [row] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1)
  return row ?? null
}

/**
 * Fetch an agent by their wallet address (case-insensitive).
 */
export async function getAgentByAddress(walletAddress: string): Promise<AgentSelect | null> {
  const [row] = await db
    .select()
    .from(agents)
    .where(eq(agents.walletAddress, walletAddress))
    .limit(1)
  return row ?? null
}

/**
 * Fetch an agent by their on-chain ID.
 */
export async function getAgentByOnchainId(onchainId: bigint): Promise<AgentSelect | null> {
  const [row] = await db
    .select()
    .from(agents)
    .where(eq(agents.onchainId, onchainId))
    .limit(1)
  return row ?? null
}

/**
 * Get all active agents, optionally filtered by type.
 */
export async function getAllAgents(filters?: {
  type?: 'client' | 'provider'
  isActive?: boolean
}): Promise<AgentSelect[]> {
  const conditions = []
  if (filters?.type) {
    conditions.push(eq(agents.agentType, filters.type))
  }
  if (filters?.isActive !== undefined) {
    conditions.push(eq(agents.isActive, filters.isActive))
  } else {
    conditions.push(eq(agents.isActive, true))
  }

  const query = db.select().from(agents)
  if (conditions.length > 0) {
    query.where(and(...conditions))
  }

  // Sort by reputation score (cast numeric string to float/numeric if needed, or simply order by numeric string column desc)
  return query.orderBy(desc(agents.reputationScore))
}

/**
 * Insert a new agent or update an existing one based on wallet address.
 */
export async function upsertAgent(agentData: AgentInsert): Promise<AgentSelect> {
  if (!agentData.walletAddress) {
    throw new Error('walletAddress is required to upsert an agent')
  }

  // Encrypt the private key at the persistence boundary (see
  // lib/crypto/walletEncryption.ts) — callers (e.g. createAgentWallet())
  // still produce plaintext, so this is the single place that must never
  // be skipped. Guarded by encryptSecretIfNeeded so re-upserting an
  // already-encrypted value (unrelated field update on an existing
  // agent) never double-encrypts.
  const walletId = agentData.walletId ? encryptSecretIfNeeded(agentData.walletId) : agentData.walletId

  const existing = await getAgentByAddress(agentData.walletAddress)
  if (existing) {
    const [updated] = await db
      .update(agents)
      .set({
        onchainId: agentData.onchainId !== undefined ? agentData.onchainId : existing.onchainId,
        name: agentData.name ?? existing.name,
        description: agentData.description ?? existing.description,
        capabilities: agentData.capabilities ?? existing.capabilities,
        walletId: walletId ?? existing.walletId,
        metadataUri: agentData.metadataUri ?? existing.metadataUri,
        reputationScore: agentData.reputationScore ?? existing.reputationScore,
        isActive: agentData.isActive !== undefined ? agentData.isActive : existing.isActive,
      })
      .where(eq(agents.id, existing.id))
      .returning()
    return updated
  } else {
    const [inserted] = await db.insert(agents).values({ ...agentData, walletId }).returning()
    return inserted
  }
}

/**
 * Updates an agent's reputation score.
 */
export async function updateAgentReputation(id: string, score: string): Promise<void> {
  await db
    .update(agents)
    .set({ reputationScore: score })
    .where(eq(agents.id, id))
}
