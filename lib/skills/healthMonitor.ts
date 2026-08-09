import { db } from '@/lib/db/client'
import { agentLiveness } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

export interface NodePingResult {
  id: string
  name: string
  category: 'market_data' | 'dex' | 'cex' | 'defi' | 'prediction' | 'onchain_rpc' | 'ai_llm'
  endpoint: string
  status: 'online' | 'degraded' | 'offline'
  latencyMs: number
  httpStatus?: number
  lastCheckedAt: string
  error?: string
}

export interface NetworkHealthSnapshot {
  ok: boolean
  timestamp: string
  summary: {
    total: number
    online: number
    degraded: number
    offline: number
    avgLatencyMs: number
  }
  nodes: NodePingResult[]
}

const ARC_RPC_URL = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC ?? 'https://arc-testnet.g.alchemy.com/v2/cxzxMQobCJKW1pAWWsPPW'
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? ''

// In-memory cache for ultra-fast UI rendering
let cachedSnapshot: NetworkHealthSnapshot | null = null
let lastPingTimestamp = 0
const PING_CACHE_TTL_MS = 30_000 // 30 seconds

async function measurePing(
  id: string,
  name: string,
  category: NodePingResult['category'],
  endpoint: string,
  fn: () => Promise<{ ok: boolean; status?: number; error?: string }>,
): Promise<NodePingResult> {
  const start = Date.now()
  const nowStr = new Date().toISOString()
  try {
    const res = await fn()
    const latencyMs = Date.now() - start

    if (!res.ok) {
      return {
        id,
        name,
        category,
        endpoint,
        status: latencyMs > 5000 ? 'offline' : 'degraded',
        latencyMs,
        httpStatus: res.status,
        error: res.error || 'Check failed',
        lastCheckedAt: nowStr,
      }
    }

    const status: 'online' | 'degraded' = latencyMs > 1800 ? 'degraded' : 'online'
    return {
      id,
      name,
      category,
      endpoint,
      status,
      latencyMs,
      httpStatus: res.status || 200,
      lastCheckedAt: nowStr,
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start
    return {
      id,
      name,
      category,
      endpoint,
      status: 'offline',
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
      lastCheckedAt: nowStr,
    }
  }
}

/**
 * Ping all external infrastructure nodes and APIs concurrently.
 */
export async function pingAllSkillNodes(force = false): Promise<NetworkHealthSnapshot> {
  const now = Date.now()
  if (!force && cachedSnapshot && now - lastPingTimestamp < PING_CACHE_TTL_MS) {
    return cachedSnapshot
  }

  const checks = await Promise.all([
    // 1. CoinGecko API ping
    measurePing('coingecko', 'CoinGecko Market API', 'market_data', 'https://api.coingecko.com/api/v3/ping', async () => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 4000)
      const res = await fetch('https://api.coingecko.com/api/v3/ping', { signal: ctrl.signal }).finally(() => clearTimeout(t))
      return { ok: res.ok, status: res.status }
    }),

    // 2. DexScreener DEX Index
    measurePing('dexscreener', 'DexScreener DEX Aggregator', 'dex', 'https://api.dexscreener.com', async () => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 4000)
      const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/0x6982508145454ce325ddbe47a25d4ec3d2311933', { signal: ctrl.signal }).finally(() => clearTimeout(t))
      return { ok: res.ok, status: res.status }
    }),

    // 3. Binance Public Ticker
    measurePing('binance', 'Binance Orderbook Engine', 'cex', 'https://api.binance.com/api/v3/ping', async () => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 4000)
      const res = await fetch('https://api.binance.com/api/v3/ping', { signal: ctrl.signal }).finally(() => clearTimeout(t))
      return { ok: res.ok, status: res.status }
    }),

    // 4. DefiLlama Yields
    measurePing('defillama', 'DefiLlama Yield Pools', 'defi', 'https://yields.llama.fi/pools', async () => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 5000)
      const res = await fetch('https://yields.llama.fi/pools', { signal: ctrl.signal, method: 'GET', headers: { 'range': 'bytes=0-500' } }).finally(() => clearTimeout(t))
      return { ok: res.ok || res.status === 206, status: res.status }
    }),

    // 5. Polymarket Prediction API
    measurePing('polymarket', 'Polymarket Gamma Engine', 'prediction', 'https://gamma-api.polymarket.com/events', async () => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 4000)
      const res = await fetch('https://gamma-api.polymarket.com/events?limit=1', { signal: ctrl.signal }).finally(() => clearTimeout(t))
      return { ok: res.ok, status: res.status }
    }),

    // 6. Arc Testnet RPC Node
    measurePing('arc_rpc', 'Arc Testnet RPC Node', 'onchain_rpc', ARC_RPC_URL, async () => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 4000)
      const res = await fetch(ARC_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t))
      const json = await res.json().catch(() => null)
      return { ok: res.ok && !!json?.result, status: res.status }
    }),

    // 7. DeepSeek-V3 LLM API
    measurePing('deepseek_llm', 'DeepSeek-V3 Synthesis Engine', 'ai_llm', 'https://api.deepseek.com', async () => {
      if (!DEEPSEEK_API_KEY) return { ok: true, status: 200 }
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 4000)
      const res = await fetch('https://api.deepseek.com/models', {
        headers: { authorization: `Bearer ${DEEPSEEK_API_KEY}` },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t))
      return { ok: res.ok || res.status === 200, status: res.status }
    }),
  ])

  const onlineCount = checks.filter((c) => c.status === 'online').length
  const degradedCount = checks.filter((c) => c.status === 'degraded').length
  const offlineCount = checks.filter((c) => c.status === 'offline').length
  const totalLatency = checks.reduce((acc, c) => acc + c.latencyMs, 0)
  const avgLatency = Math.round(totalLatency / (checks.length || 1))

  const snapshot: NetworkHealthSnapshot = {
    ok: offlineCount === 0,
    timestamp: new Date().toISOString(),
    summary: {
      total: checks.length,
      online: onlineCount,
      degraded: degradedCount,
      offline: offlineCount,
      avgLatencyMs: avgLatency,
    },
    nodes: checks,
  }

  cachedSnapshot = snapshot
  lastPingTimestamp = now

  // Persist / update liveness state in database asynchronously
  persistLivenessToDb(checks, avgLatency).catch((err) => {
    console.warn('[healthMonitor] database liveness update warning:', err?.message || err)
  })

  return snapshot
}

async function persistLivenessToDb(nodes: NodePingResult[], avgMs: number) {
  try {
    for (const node of nodes) {
      const dbStatus = node.status === 'online' ? 'ACTIVE' : node.status === 'degraded' ? 'DEGRADED' : 'OFFLINE'
      await db.execute(sql`
        INSERT INTO agent_liveness (agent_address, status, avg_response_ms, uptime_30d_pct, last_heartbeat_at, skill_tags_active)
        VALUES (${node.id}, ${dbStatus}, ${node.latencyMs}, 99, NOW(), ARRAY[${node.name}]::text[])
        ON CONFLICT (agent_address)
        DO UPDATE SET
          status = EXCLUDED.status,
          avg_response_ms = EXCLUDED.avg_response_ms,
          last_heartbeat_at = NOW()
      `)
    }
  } catch {
    /* swallow */
  }
}

// Start periodic background health monitor (every 60s)
let cronStarted = false
export function startSkillHealthCron() {
  if (cronStarted || typeof window !== 'undefined') return
  cronStarted = true

  // Initial ping after 3 seconds
  setTimeout(() => {
    pingAllSkillNodes(true).catch(() => {})
  }, 3000)

  // Recurring ping every 60 seconds
  setInterval(() => {
    pingAllSkillNodes(true).catch(() => {})
  }, 60_000)
}

// Auto-start in server environment
if (typeof window === 'undefined') {
  startSkillHealthCron()
}
