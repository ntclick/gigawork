/**
 * Lightweight, zero-dependency 5-field cron parser for deployment schedule due checks.
 */
export function isCronDue(cronExpression: string, lastCheckedAt: Date | null, now: Date = new Date()): boolean {
  if (!lastCheckedAt) return true

  const elapsedMs = now.getTime() - lastCheckedAt.getTime()
  const expr = cronExpression.trim()

  // Parse minute field (first field)
  const parts = expr.split(/\s+/)
  const minPart = parts[0] ?? '30'

  let intervalMinutes = 30
  if (minPart.startsWith('*') && minPart.includes('/')) {
    const slashIdx = minPart.indexOf('/')
    const parsed = parseInt(minPart.slice(slashIdx + 1), 10)
    if (!isNaN(parsed) && parsed > 0) intervalMinutes = parsed
  } else if (minPart === '0') {
    intervalMinutes = 60
  }

  const intervalMs = intervalMinutes * 60 * 1000
  return elapsedMs >= intervalMs
}
