function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619
  return Math.abs(h)
}

export function jitter(seed: string, base: number, pct = 0.15): number {
  const r = (hash(seed) % 1000) / 1000
  return base * (1 - pct + r * pct * 2)
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function compactValue(value: unknown): string {
  if (value == null) return 'data unavailable'
  if (typeof value === 'string') return value.length > 180 ? `${value.slice(0, 177)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 6)
    return keys.length > 0 ? keys.join(', ') : 'empty object'
  }
  return String(value)
}

export function collectSources(value: unknown, out = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    for (const item of value) collectSources(item, out)
    return out
  }
  const record = value as Record<string, unknown>
  const sourceFields = ['data_sources', 'sources', 'provider_apis']
  for (const key of sourceFields) {
    const raw = record[key]
    if (Array.isArray(raw)) {
      for (const source of raw) {
        if (source) out.add(String(source))
      }
    }
  }
  for (const nested of Object.values(record)) collectSources(nested, out)
  return out
}

export function buildDeterministicReport(data: Record<string, unknown>, note?: string): string {
  const entries = Object.entries(data)
  if (entries.length === 0) {
    return [
      '# Workflow Report',
      '',
      '## Verdict',
      'No upstream agent output was provided, so there is nothing reliable to summarize.',
      '',
      '## Next Step',
      'Re-run the workflow with at least one research agent before composing the final report.',
    ].join('\n')
  }

  const failed = entries.filter(([, value]) => {
    const record = value as Record<string, unknown> | null
    return !!record && typeof record === 'object' && ('error' in record || record.fallback === true)
  })
  const sources = [...collectSources(data)]
  const generatedAt = new Date().toISOString()

  const sections = entries.map(([key, value]) => {
    const record = value as Record<string, unknown> | null
    const lines = [`### ${key}`]
    if (!record || typeof record !== 'object') {
      lines.push(`- Result: ${compactValue(value)}`)
      return lines.join('\n')
    }

    if (record.error) lines.push(`- Status: failed (${compactValue(record.error)})`)
    else lines.push('- Status: completed')

    if (record.supporting || record.counterpoint || record.invalidation) {
      if (record.verdict) lines.push(`- **Verdict**: ${compactValue(record.verdict)}${record.confidence != null ? ` (${record.confidence}% confidence)` : ''}`)
      if (Array.isArray(record.supporting) && record.supporting.length > 0) {
        lines.push(`\n**Why**:`)
        for (const s of record.supporting) lines.push(`- ${s}`)
      }
      if (record.counterpoint) {
        lines.push(`\n**Strongest counterpoint**:\n${record.counterpoint}`)
      }
      if (record.invalidation) {
        lines.push(`\n**Invalidated if**:\n${record.invalidation}`)
      }
      if (record.dataSource || record.source) {
        lines.push(`\n*Source: ${record.dataSource || record.source}*`)
      }
      return lines.join('\n')
    }

    const preferred = [
      'summary',
      'verdict',
      'risk_score',
      'reasoning',
      'price',
      'price_usd',
      'price_change_24h_pct',
      'market_cap_usd',
      'liquidity_usd',
      'volume_24h_usd',
      'rsi_14',
      'macd_histogram',
      'signal',
      'sentiment',
    ]
    let used = 0
    for (const field of preferred) {
      if (record[field] != null && used < 6) {
        lines.push(`- ${field}: ${compactValue(record[field])}`)
        used++
      }
    }
    if (used === 0) {
      for (const [field, fieldValue] of Object.entries(record).slice(0, 6)) {
        if (field === 'generated_at') continue
        lines.push(`- ${field}: ${compactValue(fieldValue)}`)
      }
    }
    return lines.join('\n')
  })

  const health =
    failed.length === 0
      ? 'All upstream agents returned usable output.'
      : `${failed.length} upstream agent${failed.length === 1 ? '' : 's'} returned an error or fallback output.`

  return [
    '# Workflow Report',
    '',
    '## Executive Summary',
    note ? `- User objective: ${note}` : '- User objective: derived from the workflow prompt.',
    `- Agent coverage: ${entries.length} step${entries.length === 1 ? '' : 's'} processed.`,
    `- Data health: ${health}`,
    '',
    '## Evidence',
    ...sections,
    '',
    '## Sources',
    sources.length > 0 ? sources.map((source) => `- ${source}`).join('\n') : '- No source list was returned by upstream agents.',
    '',
    '## Recommended Next Step',
    failed.length > 0
      ? '- Re-run failed steps, then regenerate the report before using this result for decisions.'
      : '- Review the evidence rows above and use the raw JSON if you need exact machine-readable values.',
    '',
    `Generated at: ${generatedAt}`,
  ].join('\n')
}

export function sanitizeReportMarkdown(markdown: string): string {
  return markdown
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\uFE0E\uFE0F\u200B-\u200D]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}
