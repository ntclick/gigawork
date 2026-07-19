import { db } from '@/lib/db/client'
import { negotiations, agents } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'

export type NegotiationInsert = typeof negotiations.$inferInsert
export type NegotiationSelect = typeof negotiations.$inferSelect

export interface ChatMessage {
  id: string
  jobId: string | null
  agentId: string | null
  role: string | null
  message: string | null
  priceOffer: string | null
  createdAt: Date | null
  agentName: string | null
  agentWallet: string | null
}

/**
 * Append a new message to the negotiation chat history.
 */
export async function appendNegotiationMessage(msgData: NegotiationInsert): Promise<NegotiationSelect> {
  const [inserted] = await db
    .insert(negotiations)
    .values(msgData)
    .returning()
  return inserted
}

/**
 * Retrieve the full chat log for a job's negotiation, including sender agent names.
 */
export async function getNegotiationChat(jobId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select({
      id: negotiations.id,
      jobId: negotiations.jobId,
      agentId: negotiations.agentId,
      role: negotiations.role,
      message: negotiations.message,
      priceOffer: negotiations.priceOffer,
      createdAt: negotiations.createdAt,
      agentName: agents.name,
      agentWallet: agents.walletAddress,
    })
    .from(negotiations)
    .leftJoin(agents, eq(negotiations.agentId, agents.id))
    .where(eq(negotiations.jobId, jobId))
    .orderBy(asc(negotiations.createdAt))

  return rows
}
