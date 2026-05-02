/**
 * withDbRetry — transparently retries a DB op when the underlying error is
 * a transient network/DNS issue (Supabase pooler intermittently returns
 * `getaddrinfo ENOTFOUND` from the VN ISP).
 *
 * Strategy:
 *   - 5 attempts with exponential backoff (200ms, 400ms, 800ms, 1.6s, 3.2s)
 *   - Only retry on classifiable transient errors; everything else bubbles up
 *     immediately (so logic bugs don't sit silently retrying)
 *   - All retries log a single line so we can see flake rate without spam
 *
 * Use in API routes that hit DB:
 *
 *   const rows = await withDbRetry(() => db.select().from(workflows))
 */
const TRANSIENT_PATTERNS = [
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /getaddrinfo/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /Connection terminated/i,
  /CONNECTION_ENDED/i,
]

function isTransient(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  const cause = (e as { cause?: { message?: string; code?: string } })?.cause
  const causeMsg = cause?.message ?? ''
  const code = cause?.code ?? ''
  return (
    TRANSIENT_PATTERNS.some((p) => p.test(msg) || p.test(causeMsg)) ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT'
  )
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 5
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isTransient(e) || i === attempts - 1) throw e
      const delay = 200 * Math.pow(2, i)
      const label = opts.label ?? 'db'
      console.warn(`[withDbRetry:${label}] transient error, retry ${i + 1}/${attempts} in ${delay}ms`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}
