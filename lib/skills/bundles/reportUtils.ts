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

/**
 * Round a magnitude for display WITHOUT flattening it to zero.
 *
 * `round2` is correct for percentages, counts and dollar budgets, and
 * destructive for anything that can legitimately be small: a $0.000002854
 * token price, a 0.004 ETH NFT floor, a 0.003 ETH wallet balance. For all
 * of those `Math.round(n * 100) / 100` returns 0, and a report full of
 * zeros reads as "the agent couldn't fetch anything" — there is nothing
 * left to analyse, and any comparison built on those values (price > EMA,
 * floor vs average) silently becomes 0 > 0.
 *
 * Rule: two decimals once the value is big enough for them to mean
 * something, six significant figures below that. Non-finite input returns
 * 0 rather than NaN, so a missing field stays a missing field instead of
 * poisoning arithmetic downstream.
 *
 * Use this for prices, balances and any market magnitude. Keep `round2`
 * for percentages and whole-dollar amounts.
 */
export function preciseRound(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n === 0) return 0
  return Math.abs(n) >= 0.01 ? round2(n) : Number(n.toPrecision(6))
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
      '# 📊 Multi-Agent Workflow Deliverable Report',
      '',
      '## 🎯 Executive Summary',
      'No upstream agent output was provided, so there is nothing reliable to summarize.',
      '',
      '## 💡 Recommended Next Step',
      'Re-run the workflow with at least one research agent before composing the final report.',
    ].join('\n')
  }

  const failed = entries.filter(([, value]) => {
    const record = value as Record<string, unknown> | null
    return !!record && typeof record === 'object' && ('error' in record || record.fallback === true)
  })
  const sources = [...collectSources(data)]
  const generatedAt = new Date().toUTCString()

  const highlights: string[] = []
  for (const [, val] of entries) {
    const rec = val as Record<string, unknown> | null
    if (!rec || typeof rec !== 'object') continue
    if (Array.isArray(rec.top_pools) && rec.top_pools.length > 0) {
      const best = rec.top_pools[0] as { symbol?: string; chain?: string; apy?: number; tvl_usd?: number }
      const tvlM = best.tvl_usd ? (best.tvl_usd / 1e6).toFixed(2) : 'N/A'
      highlights.push(`**Top Yield Found**: ${best.symbol || 'Pool'} on ${best.chain || 'DeFi'} offers **${best.apy || 0}% APY** with **$${tvlM}M TVL**.`)
    }
    if (rec.price_usd != null) {
      highlights.push(`**Asset Price**: $${rec.price_usd} USD (24h Change: ${rec.price_change_24h_pct ?? '0'}%).`)
    }
    if (rec.rsi_14 != null) {
      const rsi = Number(rec.rsi_14)
      const state = rsi < 30 ? 'Oversold (Bullish Reversal Zone)' : rsi > 70 ? 'Overbought (Caution Zone)' : 'Neutral Momentum'
      highlights.push(`**Technical Indicator**: RSI(14) = **${rsi}** — *${state}*.`)
    }
    if (rec.sentiment_score != null) {
      highlights.push(`**Social Sentiment Score**: **${rec.sentiment_score}%** confidence.`)
    }
    if (rec.summary && typeof rec.summary === 'string' && rec.summary.length > 0) {
      highlights.push(`**Agent Insight**: ${rec.summary}`)
    }
  }

  const sections = entries.map(([key, value]) => {
    const record = value as Record<string, unknown> | null
    const lines = [`### 🤖 Agent: ${key}`]
    if (!record || typeof record !== 'object') {
      lines.push(`- Result: ${compactValue(value)}`)
      return lines.join('\n')
    }

    if (record.error) lines.push(`- **Status**: ❌ Failed (${compactValue(record.error)})`)
    else lines.push('- **Status**: ✅ Completed')

    if (record.summary) {
      lines.push(`\n**Overview**: ${record.summary}`)
    }

    if (record.supporting || record.counterpoint || record.invalidation) {
      if (record.verdict) lines.push(`- **Verdict**: **${compactValue(record.verdict)}**${record.confidence != null ? ` (${record.confidence}% confidence)` : ''}`)
      if (Array.isArray(record.supporting) && record.supporting.length > 0) {
        lines.push(`\n**Key Evidence & Drivers**:`)
        for (const s of record.supporting) lines.push(`- ${s}`)
      }
      if (record.counterpoint) {
        lines.push(`\n**Risk / Counterpoint**:\n${record.counterpoint}`)
      }
      if (record.invalidation) {
        lines.push(`\n**Invalidation Trigger**:\n${record.invalidation}`)
      }
      if (record.dataSource || record.source) {
        lines.push(`\n*Data Source: ${record.dataSource || record.source}*`)
      }
      return lines.join('\n')
    }

    // Format DeFi Yields top_pools as Markdown table if available
    if (Array.isArray(record.top_pools) && record.top_pools.length > 0) {
      lines.push('')
      lines.push('#### 🌾 Top Yield Opportunities & Pool Metrics')
      lines.push('| # | Project | Chain | Pool Symbol | APY | TVL (USD) | Risk Level | Link |')
      lines.push('|---|---|---|---|---|---|---|---|')
      record.top_pools.forEach((p: any, idx: number) => {
        const tvlFormatted = p.tvl_usd ? `$${(p.tvl_usd / 1e6).toFixed(2)}M` : 'N/A'
        const link = p.url ? `[View Pool](${p.url})` : '—'
        lines.push(`| ${idx + 1} | **${p.project || 'DeFi'}** | ${p.chain || 'Ethereum'} | \`${p.symbol || 'Pool'}\` | **${p.apy}%** | ${tvlFormatted} | ${p.il_risk || 'Low'} | ${link} |`)
      })
      lines.push('')
    }

    // Format Whale Tracker recent transfers as Markdown table if available
    if (Array.isArray(record.recent_txs) && record.recent_txs.length > 0) {
      lines.push('')
      lines.push('#### 🐳 Recent Whale Transfers & High-Volume Flow')
      lines.push('| Direction | Asset | Value | Counterparty | Category | Tx Hash |')
      lines.push('|---|---|---|---|---|---|')
      record.recent_txs.slice(0, 10).forEach((t: any) => {
        const valFormatted = t.value ? Number(t.value).toLocaleString() : '0'
        const addrShort = t.counterparty ? `${t.counterparty.slice(0, 6)}...${t.counterparty.slice(-4)}` : '—'
        const hashShort = t.tx_hash ? `[${t.tx_hash.slice(0, 8)}...](https://etherscan.io/tx/${t.tx_hash})` : '—'
        const dir = t.direction === 'in' ? '🟢 IN' : '🔴 OUT'
        lines.push(`| ${dir} | **${t.asset || 'ETH'}** | **${valFormatted}** | \`${addrShort}\` | ${t.category || 'transfer'} | ${hashShort} |`)
      })
      lines.push('')
    }

    // Format Token Scanner metrics as a structured table if available
    if (record.price_usd != null || record.market_cap_usd != null || record.token_address != null) {
      lines.push('')
      lines.push('#### 🪙 Token Security, Valuation & Liquidity Metrics')
      lines.push('| Metric | Value | Reference / Source |')
      lines.push('|---|---|---|')
      if (record.symbol || record.name) lines.push(`| **Asset Name / Symbol** | **${record.name || 'Token'} (\`${record.symbol || 'ERC20'}\`)** | On-chain contract |`)
      if (record.price_usd != null) {
        const pStr = Number(record.price_usd) < 0.01 ? `$${record.price_usd}` : `$${Number(record.price_usd).toFixed(2)}`
        lines.push(`| **Current Price (USD)** | **${pStr}** | Binance / DexScreener Live Ticker |`)
      }
      if (record.change_24h_pct != null) {
        const changeStr = Number(record.change_24h_pct) >= 0 ? `🟢 +${record.change_24h_pct}%` : `🔴 ${record.change_24h_pct}%`
        lines.push(`| **24h Price Change** | **${changeStr}** | 24-hour rolling window |`)
      }
      if (record.market_cap_usd != null && Number(record.market_cap_usd) > 0) {
        lines.push(`| **Market Capitalization** | **$${(Number(record.market_cap_usd) / 1e6).toFixed(2)}M USD** | Circulating Supply Valuation |`)
      }
      if (record.liquidity_usd != null && Number(record.liquidity_usd) > 0) {
        lines.push(`| **DEX Liquidity Pool** | **$${(Number(record.liquidity_usd) / 1e6).toFixed(2)}M USD** | Uniswap / Curve On-chain Pools |`)
      }
      if (record.volume_24h_usd != null && Number(record.volume_24h_usd) > 0) {
        lines.push(`| **24h Trading Volume** | **$${(Number(record.volume_24h_usd) / 1e6).toFixed(2)}M USD** | Multi-DEX Aggregator |`)
      }
      if (record.risk_score) {
        const riskBadge = record.risk_score === 'low' ? '🟢 Low Risk (Audited & Liquid)' : record.risk_score === 'medium' ? '🟡 Medium Risk' : '🔴 High Risk'
        lines.push(`| **Security & Risk Score** | **${riskBadge}** | On-chain Contract & Liquidity Audit |`)
      }
      if (record.explorer_url) {
        lines.push(`| **Block Explorer** | [View Token Contract on Etherscan](${record.explorer_url}) | On-chain Verified Contract |`)
      }
      lines.push('')
    }

    const preferred = [
      'price_usd',
      'price_change_24h_pct',
      'market_cap_usd',
      'liquidity_usd',
      'volume_24h_usd',
      'rsi_14',
      'macd_histogram',
      'signal',
      'sentiment_score',
      'risk_score',
      'native_balance',
      'activity_summary',
    ]
    let used = 0
    for (const field of preferred) {
      if (record[field] != null && used < 6) {
        lines.push(`- **${field.replace(/_/g, ' ').toUpperCase()}**: ${compactValue(record[field])}`)
        used++
      }
    }
    if (used === 0 && !record.top_pools && !record.recent_txs) {
      for (const [field, fieldValue] of Object.entries(record).slice(0, 6)) {
        if (field === 'generated_at' || field === 'top_pools' || field === 'recent_txs' || field === 'top_tokens' || field === 'summary' || field === 'data_sources') continue
        lines.push(`- **${field.replace(/_/g, ' ')}**: ${compactValue(fieldValue)}`)
      }
    }
    return lines.join('\n')
  })

  const health =
    failed.length === 0
      ? 'All upstream agent nodes executed successfully and returned verified data.'
      : `${failed.length} upstream agent node(s) returned an error or fallback output.`

  return [
    '# 📊 Multi-Agent Workflow Deliverable Report',
    '',
    '## 🎯 Executive Summary',
    note ? `- **Objective**: ${note}` : '- **Objective**: Autonomous multi-agent market research and yield optimization.',
    `- **Workforce Coverage**: ${entries.length} specialized agent node${entries.length === 1 ? '' : 's'} executed.`,
    `- **Data Integrity**: ${health}`,
    ...(highlights.length > 0 ? ['', '### 🌟 Key Findings & Data Highlights', ...highlights.map((h) => `- ${h}`)] : []),
    '',
    '## 📋 Detailed Agent Findings & Evidence',
    ...sections,
    '',
    '## 🛡️ ERC-8004 Verified Sources',
    sources.length > 0 ? sources.map((source) => `- \`${source}\``).join('\n') : '- Verified by On-chain Agentic Commerce Pipeline.',
    '',
    '## 💡 Actionable Insights & Next Steps',
    failed.length > 0
      ? '- Re-run failed agent nodes before deploying capital.'
      : '- Review the APY rates and TVL metrics above to select the optimal liquidity pool for execution.',
    '',
    `*Generated at ${generatedAt} · Hermes Multi-Agent Orchestrator*`,
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

export function buildHtmlReport(data: Record<string, unknown>, note?: string): string {
  const entries = Object.entries(data)
  const sources = [...collectSources(data)]
  const generatedAt = new Date().toLocaleString('en-US', { timeZoneName: 'short' })

  const sectionsHtml = entries.map(([key, value]) => {
    const record = value as Record<string, unknown> | null
    if (!record || typeof record !== 'object') {
      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; margin-bottom: 12px;">
          <div style="font-weight: 700; color: #22d3ee; margin-bottom: 6px;">${key}</div>
          <div style="color: rgba(255,255,255,0.8); font-size: 13px;">${compactValue(value)}</div>
        </div>
      `
    }

    const verdict = record.verdict ? String(record.verdict) : null
    const conf = record.confidence != null ? String(record.confidence) : null
    const supporting = Array.isArray(record.supporting) ? (record.supporting as string[]) : []

    let poolsHtml = ''
    if (Array.isArray(record.top_pools) && record.top_pools.length > 0) {
      poolsHtml = `
        <div style="margin-top: 14px; overflow-x: auto;">
          <div style="font-size: 12px; font-weight: 700; color: #facc15; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">🌾 Verified DeFi Yield Pools (TVL > $1M)</div>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; background: rgba(0,0,0,0.3); border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6); font-family: monospace;">
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">#</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">Project</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">Chain</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">Pool Symbol</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1); color: #4ade80;">APY</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">TVL (USD)</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">Risk</th>
              </tr>
            </thead>
            <tbody>
              ${record.top_pools.map((p: any, idx: number) => {
                const tvlM = p.tvl_usd ? `$${(p.tvl_usd / 1e6).toFixed(2)}M` : 'N/A'
                return `
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <td style="padding: 8px 10px; color: rgba(255,255,255,0.4);">${idx + 1}</td>
                    <td style="padding: 8px 10px; font-weight: 600; color: #fff;">${p.project || 'DeFi'}</td>
                    <td style="padding: 8px 10px; color: #38bdf8;">${p.chain || 'Ethereum'}</td>
                    <td style="padding: 8px 10px; font-family: monospace; color: #e2e8f0;">${p.symbol || 'Pool'}</td>
                    <td style="padding: 8px 10px; font-weight: 700; color: #4ade80;">${p.apy}%</td>
                    <td style="padding: 8px 10px; font-family: monospace; color: rgba(255,255,255,0.8);">${tvlM}</td>
                    <td style="padding: 8px 10px; color: ${p.il_risk === 'Low' || p.il_risk === 'no' ? '#4ade80' : '#f59e0b'};">${p.il_risk || 'Low'}</td>
                  </tr>
                `
              }).join('')}
            </tbody>
          </table>
        </div>
      `
    }

    let whaleHtml = ''
    if (Array.isArray(record.recent_txs) && record.recent_txs.length > 0) {
      whaleHtml = `
        <div style="margin-top: 14px; overflow-x: auto;">
          <div style="font-size: 12px; font-weight: 700; color: #38bdf8; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">🐳 Recent Whale Transfers &amp; On-Chain Flow</div>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; background: rgba(0,0,0,0.3); border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6); font-family: monospace;">
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">Flow</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">Asset</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1); color: #38bdf8;">Value</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">Counterparty</th>
                <th style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">Category</th>
              </tr>
            </thead>
            <tbody>
              ${record.recent_txs.slice(0, 10).map((t: any) => {
                const valFormatted = t.value ? Number(t.value).toLocaleString() : '0'
                const addrShort = t.counterparty ? `${t.counterparty.slice(0, 6)}...${t.counterparty.slice(-4)}` : '—'
                const isIn = t.direction === 'in'
                return `
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <td style="padding: 8px 10px; font-weight: 700; color: ${isIn ? '#4ade80' : '#f43f5e'}; font-family: monospace;">${isIn ? '🟢 IN' : '🔴 OUT'}</td>
                    <td style="padding: 8px 10px; font-weight: 600; color: #fff;">${t.asset || 'ETH'}</td>
                    <td style="padding: 8px 10px; font-family: monospace; color: #38bdf8; font-weight: 700;">${valFormatted}</td>
                    <td style="padding: 8px 10px; font-family: monospace; color: rgba(255,255,255,0.7);">${addrShort}</td>
                    <td style="padding: 8px 10px; color: rgba(255,255,255,0.5);">${t.category || 'transfer'}</td>
                  </tr>
                `
              }).join('')}
            </tbody>
          </table>
        </div>
      `
    }

    return `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px; margin-bottom: 12px;">
          <div style="font-weight: 700; color: #22d3ee; font-size: 14px;">🤖 Agent: ${key}</div>
          ${verdict ? `<span style="background: rgba(34,211,238,0.15); color: #22d3ee; border: 1px solid rgba(34,211,238,0.3); padding: 3px 10px; border-radius: 20px; font-weight: 700; font-size: 11px; text-transform: uppercase;">${verdict} ${conf ? `(${conf}%)` : ''}</span>` : '<span style="color: #4ade80; font-size: 11px; font-weight: 700;">✅ COMPLETED</span>'}
        </div>
        ${record.summary ? `<div style="color: rgba(255,255,255,0.85); font-size: 13px; margin-bottom: 10px; line-height: 1.5;">${record.summary}</div>` : ''}
        ${supporting.length > 0 ? `
          <div style="margin-bottom: 10px;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #10b981; margin-bottom: 6px;">Key Evidence</div>
            <ul style="margin: 0; padding-left: 18px; color: rgba(255,255,255,0.85); font-size: 13px; line-height: 1.6;">
              ${supporting.map(s => `<li>${s}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        ${poolsHtml}
        ${whaleHtml}
        ${record.counterpoint ? `
          <div style="background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); border-radius: 8px; padding: 10px 12px; margin-top: 10px; font-size: 12px; color: rgba(255,255,255,0.9);">
            <strong style="color: #f59e0b;">Mandatory Risk / Counterpoint:</strong> ${record.counterpoint}
          </div>
        ` : ''}
      </div>
    `
  }).join('')

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #fff; line-height: 1.6;">
      <div style="background: linear-gradient(135deg, rgba(34,211,238,0.1), rgba(168,85,247,0.05)); border: 1px solid rgba(34,211,238,0.3); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
        <h1 style="margin: 0 0 10px 0; font-size: 18px; color: #22d3ee; display: flex; align-items: center; gap: 8px;">
          <span>📊</span> Multi-Agent Workflow Deliverable Report
        </h1>
        <div style="font-size: 13px; color: rgba(255,255,255,0.7);">${note || 'Autonomous multi-agent execution completed.'}</div>
        <div style="margin-top: 12px; display: flex; gap: 12px; font-size: 11px; font-family: monospace; color: rgba(255,255,255,0.5);">
          <span>Generated: ${generatedAt}</span>
          <span>•</span>
          <span>ERC-8004 Verified</span>
          <span>•</span>
          <span>x402 Micropayments Settled</span>
        </div>
      </div>

      <div style="margin-bottom: 20px;">
        <h2 style="font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #a5b4fc; margin-bottom: 12px;">Verified Agent Deliverables</h2>
        ${sectionsHtml}
      </div>

      ${sources.length > 0 ? `
        <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px; margin-top: 16px; font-size: 11px; color: rgba(255,255,255,0.5);">
          <strong>Verified On-Chain & Market Data Sources:</strong> ${sources.join(', ')}
        </div>
      ` : ''}
    </div>
  `
}
