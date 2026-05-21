/**
 * curlFetch — last-resort fetch that shells out to the system `curl` binary.
 *
 * Why: Cloudflare in front of some APIs (notably Polymarket) blocks
 * Node.js/undici based on TLS fingerprint (JA3/JA4 detection), even when
 * User-Agent + headers are spoofed. The actual `curl` binary uses a
 * different TLS handshake that Cloudflare accepts.
 *
 * We combine this with DoH (1.1.1.1) so DNS-blocked hosts also work:
 *   1. Resolve hostname via DoH → get IP
 *   2. Spawn `curl --resolve host:443:ip <url>` so curl skips DNS
 *   3. Curl uses its own TLS handshake → Cloudflare lets it through
 *
 * Curl is shipped with Windows 10+, macOS, and every Linux distro since 2018,
 * so this is portable. Vercel runtime has curl available too.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fetch as undiciFetch } from 'undici'

const execFileP = promisify(execFile)

const DOH_URL = 'https://1.1.1.1/dns-query'
const CACHE_TTL_MS = 5 * 60 * 1000
const dohCache = new Map<string, { ip: string; expiresAt: number }>()

async function resolveViaDoh(hostname: string): Promise<string> {
  const cached = dohCache.get(hostname)
  if (cached && cached.expiresAt > Date.now()) return cached.ip
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await undiciFetch(`${DOH_URL}?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: ctrl.signal,
    })
    if (!r.ok) throw new Error(`doh ${hostname}: HTTP ${r.status}`)
    const j = (await r.json()) as { Status: number; Answer?: { type: number; data: string }[] }
    if (j.Status !== 0) throw new Error(`doh ${hostname}: status ${j.Status}`)
    const ipv4 = j.Answer?.find((a) => a.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(a.data))?.data
    if (!ipv4) throw new Error(`doh ${hostname}: no A record`)
    dohCache.set(hostname, { ip: ipv4, expiresAt: Date.now() + CACHE_TTL_MS })
    return ipv4
  } finally {
    clearTimeout(timer)
  }
}

export interface CurlFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

/**
 * Same shape as fetchJSON but uses the curl binary under the hood.
 * Returns parsed JSON. Throws on HTTP errors or non-JSON response.
 */
export async function curlFetchJSON<T = unknown>(url: string, opts: CurlFetchOptions = {}): Promise<T> {
  const u = new URL(url)
  const port = u.port || (u.protocol === 'https:' ? '443' : '80')
  const ip = await resolveViaDoh(u.hostname)

  const args: string[] = [
    '--silent',
    '--show-error',
    '--max-time', String(Math.ceil((opts.timeoutMs ?? 10_000) / 1000)),
    '--resolve', `${u.hostname}:${port}:${ip}`,
    // Capture HTTP status separately so we can distinguish 4xx/5xx from network errors
    '--write-out', '\n__HTTP_STATUS__:%{http_code}',
  ]

  if (opts.method && opts.method !== 'GET') {
    args.push('-X', opts.method)
  }
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      args.push('-H', `${k}: ${v}`)
    }
  }
  if (opts.body) {
    args.push('--data-raw', opts.body)
  }

  args.push(url)

  let stdout: string
  try {
    const result = await execFileP('curl', args, {
      maxBuffer: 50 * 1024 * 1024, // 50 MB — DefiLlama returns ~13 MB
      timeout: (opts.timeoutMs ?? 10_000) + 2000, // process-level timeout slightly > curl's own
    })
    stdout = result.stdout
  } catch (e) {
    const err = e as Error & { stderr?: string; code?: number }
    throw new Error(`curl failed: ${err.stderr ?? err.message}`)
  }

  // Split out the status line we appended via --write-out
  const lastNewline = stdout.lastIndexOf('\n__HTTP_STATUS__:')
  let body = stdout
  let status = 0
  if (lastNewline >= 0) {
    body = stdout.slice(0, lastNewline)
    status = parseInt(stdout.slice(lastNewline + '\n__HTTP_STATUS__:'.length).trim(), 10) || 0
  }

  if (status >= 400 || status === 0) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      const errMsg = parsed.description || parsed.message || parsed.error || ''
      if (errMsg) {
        throw new Error(`HTTP ${status} from ${u.hostname}${u.pathname}: ${errMsg} via curl`)
      }
    } catch {}
    throw new Error(`HTTP ${status} from ${u.hostname}${u.pathname} via curl`)
  }

  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error(`curl response from ${u.hostname} was not JSON (first 200 chars: ${body.slice(0, 200)})`)
  }
}

/** Diagnostic helper for /api/doh-debug. */
export async function probeCurl(host: string, path: string): Promise<{
  host: string
  path: string
  ok: boolean
  preview?: string
  error?: string
}> {
  try {
    const data = await curlFetchJSON(`https://${host}${path}`, {
      timeoutMs: 12_000,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        accept: 'application/json',
      },
    })
    return {
      host,
      path,
      ok: true,
      preview: Array.isArray(data) ? `array len ${data.length}` : 'json received',
    }
  } catch (e) {
    return { host, path, ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}
