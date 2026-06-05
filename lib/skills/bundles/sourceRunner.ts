export type SourceResult<T = unknown> = {
  source: string
  ok: boolean
  durationMs: number
  data?: T
  error?: string
}

export async function runSource<T>(
  source: string,
  fn: () => Promise<T>,
): Promise<SourceResult<T>> {
  const started = Date.now()
  try {
    const data = await fn()
    return { source, ok: true, durationMs: Date.now() - started, data }
  } catch (e) {
    return {
      source,
      ok: false,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function summarizeSources(results: SourceResult[]): {
  ok: string[]
  failed: { source: string; error: string }[]
  partial: boolean
} {
  return {
    ok: results.filter((r) => r.ok).map((r) => r.source),
    failed: results.filter((r) => !r.ok).map((r) => ({ source: r.source, error: r.error ?? 'unknown' })),
    partial: results.some((r) => !r.ok),
  }
}
