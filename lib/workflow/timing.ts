export type TimingEvent = {
  name: string
  startedAt: string
  endedAt: string
  durationMs: number
  ok: boolean
  metadata?: Record<string, unknown>
}

export type TimedError = Error & { timingEvent?: TimingEvent }

export async function timed<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<{ value: T; event: TimingEvent }> {
  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  try {
    const value = await fn()
    const ended = Date.now()
    return {
      value,
      event: {
        name,
        startedAt,
        endedAt: new Date(ended).toISOString(),
        durationMs: ended - started,
        ok: true,
        metadata,
      },
    }
  } catch (error) {
    const ended = Date.now()
    const event = {
      name,
      startedAt,
      endedAt: new Date(ended).toISOString(),
      durationMs: ended - started,
      ok: false,
      metadata: {
        ...metadata,
        error: error instanceof Error ? error.message : String(error),
      },
    }
    const err = error instanceof Error ? error : new Error(String(error))
    ;(err as TimedError).timingEvent = event
    throw err
  }
}

export async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`)
      ctrl.abort(error)
      reject(error)
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      fn(ctrl.signal),
      timeoutPromise,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
