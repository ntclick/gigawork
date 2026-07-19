import { db } from '@/lib/db/client'
import { nanopaymentEvents } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { IDENTITY_REGISTRY } from '@/contracts/addresses'

interface RegistryManifest {
  cost_credits?: number
  price_override?: string
  disabled?: boolean
  display_name?: string
  category?: string
}

export interface AgentInfo {
  id?: string
  address: string              // ERC-8004 identity address
  name: string                 // Display name
  slug: string                 // Slug name (e.g. "crypto-scanner")
  category: string
  pricePerCall: string         // USDC, string for precision
  reputation: number | null    // null if no attestation data
  status: 'online' | 'busy' | 'offline' | 'unknown'
  totalEarnings: string        // USDC, "0.00" if no data
  totalCalls: number
  source: 'on-chain' | 'cache' | 'fallback'  // debug info
  manifest?: RegistryManifest  // Raw manifest containing input_schema, description, keywords, etc.
}

/**
 * Lấy danh sách agent. Thứ tự ưu tiên:
 * 1. Query ERC-8004 registry on-chain trực tiếp (nếu có contract address configured)
 * 2. Query ChainLens/Goldsky index (nếu (1) fail hoặc chậm — đây là cache của (1))
 * 3. Fallback về `skills` table hiện có trong DB (chỉ khi (1) và (2) đều fail/rỗng)
 *
 * Bất kể nguồn nào, luôn enrich thêm earnings/calls từ nanopaymentEvents
 * vì đó là data của riêng GigaWork, không nằm trên ERC-8004 registry.
 */
export async function listAgents(): Promise<AgentInfo[]> {
  let agents: AgentInfo[] = []

  try {
    agents = await fetchFromOnChainRegistry()
  } catch (err) {
    console.warn('[agents/registry] on-chain fetch failed, trying index cache:', err instanceof Error ? err.message : String(err))
  }

  if (agents.length === 0) {
    try {
      agents = await fetchFromChainLensIndex()
    } catch (err) {
      console.warn('[agents/registry] ChainLens index fetch failed, falling back to DB:', err instanceof Error ? err.message : String(err))
    }
  }

  if (agents.length === 0) {
    agents = await fetchFromDbSkillsFallback()
  }

  return enrichWithEarnings(agents)
}

async function fetchFromOnChainRegistry(): Promise<AgentInfo[]> {
  if (!IDENTITY_REGISTRY) {
    throw new Error('IDENTITY_REGISTRY address not configured in contracts/addresses.ts')
  }
  // The contract does not expose an enumerable token list. Without an event indexer
  // or custom API, direct on-chain enumeration is not feasible/performant.
  throw new Error('On-chain Identity Registry does not support enumerable index list. Subgraph/ChainLens index is required for direct discovery.')
}

async function fetchFromChainLensIndex(): Promise<AgentInfo[]> {
  // ChainLens indexer is not configured or deployed in the current testnet environment.
  throw new Error('ChainLens/Goldsky event indexer is not configured in GigaWork.')
}

async function fetchFromDbSkillsFallback(): Promise<AgentInfo[]> {
  // Fall back to skills table in local DB
  const { listSkills } = await import('@/lib/skills/registry')
  const skills = await listSkills()
  return skills.map(s => {
    const m = (s.manifest as RegistryManifest ?? {})
    const costCredits = m.cost_credits ?? 8
    
    // Override price if manifest has price_override
    const priceUsdc = m.price_override !== undefined ? parseFloat(m.price_override).toFixed(2) : (costCredits * 0.01).toFixed(2)
    
    // Override status if manifest has disabled = true
    let status: 'online' | 'busy' | 'offline' | 'unknown' = 'unknown'
    if (m.disabled === true) {
      status = 'offline'
    } else {
      status = s.livenessStatus === 'ACTIVE' ? 'online' : s.livenessStatus === 'DEGRADED' ? 'busy' : s.livenessStatus === 'INACTIVE' ? 'offline' : 'online'
    }

    return {
      id: s.id,
      address: s.agentAddress ?? '0x0000000000000000000000000000000000000000',
      name: m.display_name ?? s.name,
      slug: s.name,
      category: m.category ?? 'general',
      pricePerCall: priceUsdc,
      reputation: s.reputationScore ?? null,
      status,
      totalEarnings: '0.00',
      totalCalls: 0,
      source: 'fallback' as const,
      manifest: m,
    }
  })
}

async function enrichWithEarnings(agents: AgentInfo[]): Promise<AgentInfo[]> {
  try {
    const stats = await db
      .select({
        skillName: nanopaymentEvents.skillName,
        callsCount: sql<number>`count(*)::int`,
        totalEarnings: sql<string>`coalesce(sum(${nanopaymentEvents.amountUsdc}::numeric), 0)`
      })
      .from(nanopaymentEvents)
      .where(eq(nanopaymentEvents.status, 'settled'))
      .groupBy(nanopaymentEvents.skillName)

    const statsMap = new Map<string, { callsCount: number; totalEarnings: string }>()
    for (const s of stats) {
      if (s.skillName) {
        statsMap.set(s.skillName.toLowerCase(), {
          callsCount: s.callsCount,
          totalEarnings: s.totalEarnings
        })
      }
    }

    return agents.map(a => {
      const stat = statsMap.get(a.slug.toLowerCase())
      return {
        ...a,
        totalCalls: stat?.callsCount ?? 0,
        totalEarnings: parseFloat(stat?.totalEarnings ?? '0').toFixed(2),
      }
    })
  } catch (err) {
    console.error('[agents/registry] Failed to enrich agents with earnings:', err)
    return agents
  }
}
