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
import { spawn } from 'node:child_process'
import { fetch as undiciFetch } from 'undici'

/**
 * Run curl with the request body piped through STDIN rather than passed
 * as an argv entry.
 *
 * Passing it as an argument (`--data-raw <json>`) corrupts every
 * non-ASCII byte on Windows, because process arguments are encoded with
 * the system ANSI codepage. Any prompt containing an em-dash or a smart
 * quote came out mangled and the provider rejected the whole request
 * with `invalid unicode code point`. stdin is a plain byte stream, so
 * UTF-8 survives intact on every platform.
 */
function runCurl(
  args: string[],
  body: string | undefined,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, { windowsHide: true })
    const chunks: Buffer[] = []
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`curl timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`curl failed to start: ${e.message}`))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stdout = Buffer.concat(chunks).toString('utf8')
      if (code !== 0 && !stdout) {
        reject(new Error(`curl exited ${code}: ${stderr || 'no output'}`))
        return
      }
      resolve(stdout)
    })

    // EPIPE if curl exits before we finish writing — harmless, the close
    // handler already carries the outcome.
    child.stdin.on('error', () => {})
    if (body !== undefined) child.stdin.write(Buffer.from(body, 'utf8'))
    child.stdin.end()
  })
}

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
  // `@-` reads the body from stdin — see runCurl for why it must not be
  // passed as an argument.
  if (opts.body !== undefined) {
    args.push('--data-binary', '@-')
  }

  args.push(url)

  let stdout: string
  try {
    stdout = await runCurl(args, opts.body, (opts.timeoutMs ?? 10_000) + 2000)
  } catch (e) {
    throw new Error(`curl failed: ${e instanceof Error ? e.message : String(e)}`)
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
    // Pull the provider's own error text out of the body. The `throw`
    // used to live INSIDE this try block, so the bare `catch {}` below
    // swallowed it and every failure surfaced as a bare "HTTP 400 …",
    // hiding the one piece of information needed to fix it.
    let detail = ''
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      const err = parsed.error
      detail = String(
        (err && typeof err === 'object' ? (err as Record<string, unknown>).message : err) ??
          parsed.description ??
          parsed.message ??
          '',
      )
    } catch {
      detail = body.slice(0, 200)
    }
    throw new Error(
      `HTTP ${status} from ${u.hostname}${u.pathname}${detail ? `: ${detail}` : ''} via curl`,
    )
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
