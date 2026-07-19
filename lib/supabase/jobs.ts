import { db } from '@/lib/db/client'
import { jobs, agents } from '@/lib/db/schema'
import { eq, or, desc } from 'drizzle-orm'

export type JobInsert = typeof jobs.$inferInsert
export type JobSelect = typeof jobs.$inferSelect
export type AgentSelect = typeof agents.$inferSelect

export interface JobWithAgents extends JobSelect {
  client: AgentSelect | null
  provider: AgentSelect | null
}

/**
 * Fetch a job by its UUID, including associated agent profiles.
 */
export async function getJobById(id: string): Promise<JobWithAgents | null> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1)

  if (!job) return null

  const client = job.clientAgentId
    ? await db.select().from(agents).where(eq(agents.id, job.clientAgentId)).limit(1).then((r) => r[0] || null)
    : null

  const provider = job.providerAgentId
    ? await db.select().from(agents).where(eq(agents.id, job.providerAgentId)).limit(1).then((r) => r[0] || null)
    : null

  return {
    ...job,
    client,
    provider,
  }
}

/**
 * Get all jobs, ordered by creation date.
 */
export async function getAllJobs(): Promise<JobSelect[]> {
  return db
    .select()
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
}

/**
 * Get all jobs for a specific agent (either as client or provider).
 */
export async function getJobsForAgent(agentId: string): Promise<JobSelect[]> {
  return db
    .select()
    .from(jobs)
    .where(or(eq(jobs.clientAgentId, agentId), eq(jobs.providerAgentId, agentId)))
    .orderBy(desc(jobs.createdAt))
}

/**
 * Create a new job in the database.
 */
export async function createJobInDb(jobData: JobInsert): Promise<JobSelect> {
  const [inserted] = await db
    .insert(jobs)
    .values(jobData)
    .returning()
  return inserted
}

/**
 * Update the status of a job.
 */
export async function updateJobStatus(
  id: string,
  status: string,
  extra?: {
    onchainJobId?: bigint
    fundedAt?: Date
    completedAt?: Date
    deliverableHash?: string
  }
): Promise<JobSelect> {
  const updateData: Partial<JobInsert> = { status }

  if (extra?.onchainJobId !== undefined) {
    updateData.onchainJobId = extra.onchainJobId
  }
  if (extra?.fundedAt !== undefined) {
    updateData.fundedAt = extra.fundedAt
  }
  if (extra?.completedAt !== undefined) {
    updateData.completedAt = extra.completedAt
  }
  if (extra?.deliverableHash !== undefined) {
    updateData.deliverableHash = extra.deliverableHash
  }

  const [updated] = await db
    .update(jobs)
    .set(updateData)
    .where(eq(jobs.id, id))
    .returning()

  return updated
}
