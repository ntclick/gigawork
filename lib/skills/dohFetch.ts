/**
 * dohFetch — fetch wrapper that resolves DNS via Cloudflare 1.1.1.1 over HTTPS.
 *
 * Why: some ISPs (notably VN, CN, RU) block specific TLDs at the DNS resolver
 * (Polymarket, Manifold, Kalshi, etc.). The endpoints themselves are reachable
 * — only the DNS lookup fails. We bypass by:
 *   1. Resolving the hostname via Cloudflare DoH (1.1.1.1)
 *   2. Pointing the URL at the resolved IP
 *   3. Setting `connect.servername` so TLS SNI still uses the original hostname
 *      (cert validates correctly against IP).
 *   4. Setting `Host` request header so HTTP virtual hosting works.
 *
 * Result: TLS + HTTP both happy, and the OS DNS resolver is bypassed entirely.
 */
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici'

const DOH_URL = 'https://1.1.1.1/dns-query'
const CACHE_TTL_MS = 5 * 60 * 1000

const dohCache = new Map<string, { ip: string; expiresAt: number }>()

interface DohAnswer {
  Status: number
  Answer?: { name: string; type: number; TTL: number; data: string }[]
}

async function dohResolve(hostname: string): Promise<string> {
  const cached = dohCache.get(hostname)
  if (cached && cached.expiresAt > Date.now()) return cached.ip

  const r = await undiciFetch(`${DOH_URL}?name=${encodeURIComponent(hostname)}&type=A`, {
    headers: { accept: 'application/dns-json' },
  })
  if (!r.ok) throw new Error(`doh ${hostname}: HTTP ${r.status}`)
  const j = (await r.json()) as DohAnswer
  if (j.Status !== 0) throw new Error(`doh ${hostname}: status ${j.Status}`)
  const ipv4 = j.Answer?.find((a) => a.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(a.data))?.data
  if (!ipv4) throw new Error(`doh ${hostname}: no A record`)
  dohCache.set(hostname, { ip: ipv4, expiresAt: Date.now() + CACHE_TTL_MS })
  return ipv4
}

/**
 * Drop-in replacement for global `fetch` that pre-resolves DNS via DoH and
 * overrides TLS SNI so cert validation works when connecting by IP.
 *
 * Use only for hosts you know are DNS-blocked. Each hostname gets its own
 * tiny agent (cached implicitly via undici's connection pool — different
 * SNIs need different agents).
 */
const agentByHost = new Map<string, Agent>()

function getAgentForHost(hostname: string): Agent {
  let a = agentByHost.get(hostname)
  if (!a) {
    a = new Agent({
      connect: {
        // SNI override so cert presented for `hostname` validates even though
        // we connected to a numeric IP.
        servername: hostname,
      },
    })
    agentByHost.set(hostname, a)
  }
  return a
}

export async function dohFetchJSON<T = unknown>(
  url: string,
  opts: UndiciRequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const u = new URL(url)
  const ip = await dohResolve(u.hostname)
  const ipUrl = `${u.protocol}//${ip}${u.port ? ':' + u.port : ''}${u.pathname}${u.search}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000)
  try {
    // Force the Host header so the upstream server's vhost routing still works.
    // (undici defaults Host to the URL host, which would be the IP — wrong.)
    const headers: Record<string, string> = {
      ...((opts.headers ?? {}) as Record<string, string>),
      host: u.host,
    }

    const res = await undiciFetch(ipUrl, {
      ...opts,
      headers,
      signal: ctrl.signal,
      dispatcher: getAgentForHost(u.hostname),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${u.hostname}${u.pathname}`)
    return (await res.json()) as T
  } catch (e) {
    // Surface undici's nested cause for easier debugging.
    if (e instanceof Error) {
      const cause = (e as Error & {
        cause?: { code?: string; message?: string; errors?: { message: string }[] }
      }).cause
      const causeMsg =
        cause?.errors?.map((x) => x.message).join('; ') ??
        cause?.message ??
        cause?.code
      if (causeMsg) {
        throw new Error(`${e.message} :: ${causeMsg}`)
      }
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** Diagnostic helper for /api/doh-debug. */
export async function probeDoh(hostname: string): Promise<{
  hostname: string
  resolved_ip: string | null
  error?: string
}> {
  try {
    const ip = await dohResolve(hostname)
    return { hostname, resolved_ip: ip }
  } catch (e) {
    return { hostname, resolved_ip: null, error: e instanceof Error ? e.message : 'unknown' }
  }
}
