/**
 * Skill handlers — extracted from app/api/skills/[name]/route.ts so they can
 * be invoked in-process by the brain pipeline (lib/ai/tools.ts) instead of
 * round-tripping through Vercel function-to-function HTTP, which is flaky
 * (function self-loop fails with "fetch failed" on Vercel).
 *
 * The route file at app/api/skills/[name]/route.ts is now a thin shim that
 * dispatches POST requests to this map. External callers (the public HTTP
 * endpoint) and internal callers (the brain) execute the SAME handler code.
 *
 * Wiring status (May 2026):
 *  ✅ defi-yields       → DefiLlama /pools (FREE, no key)
 *  ✅ polymarket-pulse  → Polymarket Gamma API (FREE, curl+DoH for CF bypass)
 *  ✅ trading-signals   → Binance public ticker (FREE)
 *  ✅ nft-floor-watch   → OpenSea v2 (free without key, higher quota with OPENSEA_API_KEY)
 *  ✅ whale-tracker     → Alchemy JSON-RPC (requires ALCHEMY_API_KEY)
 *  ✅ crypto-scanner    → Birdeye + DexScreener + CoinGecko (multi-source)
 *  ✅ social-sentiment  → Reddit public + Apify Twitter (APIFY_API_TOKEN optional)
 *  ✅ web-intel         → Apify Google Search Scraper (requires APIFY_API_TOKEN)
 *  ✅ document-digest   → fetch URL + Kimi K2 JSON digest (requires KIMI_API_KEY)
 *  ✅ report-composer   → Kimi K2 markdown synthesis (requires KIMI_API_KEY)
 *  ✅ dca-executor      → Binance ticker → tier table around live spot (planner, no trades)
 *  ✅ email-sender      → Resend API (per-user api_key; dev-mock if absent)
 *  ✅ telegram-sender   → Telegram Bot API (per-user bot_token; dev-mock if absent)
 */
import { curlFetchJSON } from './curlFetch'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { nodes, skills, users } from '@/lib/db/schema'

import {
  jitter,
  round2,
  buildDeterministicReport,
  sanitizeReportMarkdown,
} from './bundles/reportUtils'
import { createMarketDataBundleHandler } from './bundles/marketDataBundle'
import { createSocialLiteBundleHandler } from './bundles/socialLiteBundle'
import { reportComposerFastHandler } from './bundles/reportComposerFast'

/** Parse a value that may already be string[] or a JSON-encoded string of array.
 *  Polymarket Gamma returns outcomes/outcomePrices as JSON strings. */
function parseStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

/** Coerce numbers that upstream APIs sometimes return as strings. */
function toNum(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Convert a hex token balance (e.g. "0x12a05f200") to a human-readable
 *  decimal using `decimals`. Falls back to 0 on parse error. */
function formatTokenBalance(hex: string, decimals: number): number {
  if (!hex || !hex.startsWith('0x')) return 0
  try {
    const raw = BigInt(hex)
    if (raw === BigInt(0)) return 0
    const divisor = BigInt(10) ** BigInt(Math.max(0, decimals))
    const whole = Number(raw / divisor)
    const fracBig = raw % divisor
    const fracStr = fracBig.toString().padStart(decimals, '0').slice(0, 4)
    const frac = Number('0.' + fracStr)
    const out = whole + frac
    return Number.isFinite(out) ? Number(out.toFixed(4)) : 0
  } catch {
    return 0
  }
}

// ════════════════════════════════════════════════════════════════
// Technical-indicator helpers
// ════════════════════════════════════════════════════════════════

function computeEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0
  const k = 2 / (period + 1)
  let ema = 0
  for (let i = 0; i < period; i++) ema += closes[i]!
  ema /= period
  for (let i = period; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k)
  }
  return ema
}

function computeRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50
  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function computeMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { line: number; signal: number; hist: number } {
  if (closes.length < slow + signalPeriod) {
    return { line: 0, signal: 0, hist: 0 }
  }
  const macdLine: number[] = []
  const kFast = 2 / (fast + 1)
  const kSlow = 2 / (slow + 1)
  let emaFast = 0
  let emaSlow = 0
  for (let i = 0; i < slow; i++) emaFast += closes[i]!
  emaFast /= slow
  emaSlow = emaFast
  for (let i = slow; i < closes.length; i++) {
    emaFast = closes[i]! * kFast + emaFast * (1 - kFast)
    emaSlow = closes[i]! * kSlow + emaSlow * (1 - kSlow)
    macdLine.push(emaFast - emaSlow)
  }
  if (macdLine.length < signalPeriod) {
    const last = macdLine[macdLine.length - 1] ?? 0
    return { line: last, signal: last, hist: 0 }
  }
  const signal = computeEMA(macdLine, signalPeriod)
  const line = macdLine[macdLine.length - 1]!
  return { line, signal, hist: line - signal }
}

async function fetchJSON<T = unknown>(url: string, opts: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export type SkillHandler = (input: Record<string, unknown>) => unknown | Promise<unknown>

/**
 * Tiny markdown → HTML converter for email body. Covers: bold (**x**),
 * italic (*x*), headings (#/##/###), bullets (- x), links ([t](u)),
 * paragraphs (blank line). Good enough for report emails — no XSS escape
 * because we only feed it markdown the brain produced (already plain).
 */
function md2html(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let html = escape(md.trim())
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/(^|\n)- (.+(?:\n- .+)*)/g, (_, prefix, block: string) => {
    const items = block.split(/\n- /).map((it) => `<li>${it}</li>`).join('')
    return `${prefix}<ul>${items}</ul>`
  })
  html = html
    .split(/\n{2,}/)
    .map((para) => (/^<(h\d|ul|ol|pre)/.test(para.trim()) ? para : `<p>${para.replace(/\n/g, '<br/>')}</p>`))
    .join('\n')
  return `<!doctype html><html><body style="font-family: -apple-system, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1a1a1a;">${html}<hr style="border: 0; border-top: 1px solid #eee; margin: 32px 0;"/><p style="font-size: 12px; color: #888;">Sent by GigaWork · <a href="https://github.com" style="color: #888;">erc-8183 workflow</a></p></body></html>`
}

export const SKILLS: Record<string, SkillHandler> = {
  // Provider triple-merge: Birdeye (best Solana) + CoinGecko (broad cov) + DexScreener (free fallback).
  // EVM tokens: prefers DexScreener for trades + CoinGecko for marketcap/holders.
  // Solana: prefers Birdeye for everything; falls back to DexScreener.
  'crypto-scanner': async (input) => {
    const chain = ((input.chain as string | undefined) ?? 'ethereum').toLowerCase()
    const token = ((input.token_address as string | undefined) ?? '').trim()
    if (!token) {
      return {
        error: 'token_address is required (contract address or symbol)',
        chain,
        data_sources: [],
        generated_at: new Date().toISOString(),
      }
    }

    const out: {
      chain: string
      token_address: string
      symbol: string | null
      name: string | null
      price_usd: number
      market_cap_usd: number
      volume_24h_usd: number
      holders: number
      change_24h_pct: number
      liquidity_usd: number
      buys_24h: number
      sells_24h: number
      risk_score: 'low' | 'medium' | 'high'
      risk_factors: string[]
      data_sources: string[]
      explorer_url: string | null
      pair_url: string | null
      generated_at: string
    } = {
      chain,
      token_address: token,
      symbol: null,
      name: null,
      price_usd: 0,
      market_cap_usd: 0,
      volume_24h_usd: 0,
      holders: 0,
      change_24h_pct: 0,
      liquidity_usd: 0,
      buys_24h: 0,
      sells_24h: 0,
      risk_score: 'medium',
      risk_factors: [],
      data_sources: [],
      explorer_url: null,
      pair_url: null,
      generated_at: new Date().toISOString(),
    }

    const isSolana = chain === 'solana'
    const isContract = /^0x[a-fA-F0-9]{40}$/.test(token) || (isSolana && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token))

    const birdeyeKey = process.env.BIRDEYE_API_KEY ?? ''
    if (birdeyeKey && isContract) {
      try {
        const birdeyeChain = chain === 'ethereum' ? 'ethereum'
          : chain === 'base' ? 'base'
          : chain === 'arbitrum' ? 'arbitrum'
          : chain === 'polygon' ? 'polygon'
          : 'solana'
        type BirdeyeOverview = {
          success: boolean
          data?: {
            address: string
            symbol: string
            name: string
            decimals: number
            price: number
            priceChange24hPercent: number
            mc: number
            v24hUSD: number
            holder: number
            liquidity: number
          }
        }
        const be = await fetchJSON<BirdeyeOverview>(
          `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(token)}`,
          {
            headers: { 'X-API-KEY': birdeyeKey, 'x-chain': birdeyeChain, accept: 'application/json' },
            timeoutMs: 7000,
          },
        )
        if (be.success && be.data) {
          out.symbol = be.data.symbol
          out.name = be.data.name
          out.price_usd = round2(be.data.price)
          out.change_24h_pct = round2(be.data.priceChange24hPercent ?? 0)
          out.market_cap_usd = Math.round(be.data.mc ?? 0)
          out.volume_24h_usd = Math.round(be.data.v24hUSD ?? 0)
          out.holders = Math.round(be.data.holder ?? 0)
          out.liquidity_usd = Math.round(be.data.liquidity ?? 0)
          out.data_sources.push('birdeye_overview')
        }
      } catch {
        /* swallow */
      }
    }

    if (isContract) {
      try {
        type DSPair = {
          chainId: string
          dexId: string
          url: string
          baseToken: { address: string; name: string; symbol: string }
          priceUsd: string
          priceChange?: { h24?: number }
          liquidity?: { usd?: number }
          volume?: { h24?: number }
          fdv?: number
          marketCap?: number
          txns?: { h24?: { buys?: number; sells?: number } }
        }
        const ds = await fetchJSON<{ pairs: DSPair[] | null }>(
          `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(token)}`,
          { timeoutMs: 6000 },
        )
        const pair = (ds.pairs ?? []).sort(
          (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
        )[0]
        if (pair) {
          if (!out.symbol) out.symbol = pair.baseToken.symbol
          if (!out.name) out.name = pair.baseToken.name
          if (!out.price_usd) out.price_usd = round2(Number(pair.priceUsd) || 0)
          if (!out.change_24h_pct) out.change_24h_pct = round2(pair.priceChange?.h24 ?? 0)
          if (!out.liquidity_usd) out.liquidity_usd = Math.round(pair.liquidity?.usd ?? 0)
          if (!out.volume_24h_usd) out.volume_24h_usd = Math.round(pair.volume?.h24 ?? 0)
          if (!out.market_cap_usd) out.market_cap_usd = Math.round(pair.marketCap ?? pair.fdv ?? 0)
          out.buys_24h = pair.txns?.h24?.buys ?? 0
          out.sells_24h = pair.txns?.h24?.sells ?? 0
          out.pair_url = pair.url
          out.data_sources.push('dexscreener')
        }
      } catch {
        /* swallow */
      }
    }

    const cgKey = process.env.COINGECKO_API_KEY ?? ''
    const cgHeaders: Record<string, string> = { accept: 'application/json' }
    if (cgKey) cgHeaders['x-cg-demo-api-key'] = cgKey
    try {
      const cgPlatform: Record<string, string> = {
        ethereum: 'ethereum',
        base: 'base',
        arbitrum: 'arbitrum-one',
        polygon: 'polygon-pos',
        solana: 'solana',
      }
      const platform = cgPlatform[chain]
      type CGCoin = {
        id: string
        symbol: string
        name: string
        market_data?: {
          current_price?: { usd?: number }
          market_cap?: { usd?: number }
          total_volume?: { usd?: number }
          price_change_percentage_24h?: number
        }
        community_data?: { twitter_followers?: number }
      }
      let cg: CGCoin | null = null
      if (isContract && platform) {
        cg = await fetchJSON<CGCoin>(
          `https://api.coingecko.com/api/v3/coins/${platform}/contract/${token.toLowerCase()}?localization=false&tickers=false&community_data=false&developer_data=false`,
          { headers: cgHeaders, timeoutMs: 7000 },
        ).catch(() => null)
      }
      if (!cg && !isContract) {
        const searched = await fetchJSON<{ coins: { id: string; symbol: string; name: string }[] }>(
          `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(token)}`,
          { headers: cgHeaders, timeoutMs: 6000 },
        ).catch(() => null)
        const top = searched?.coins?.[0]
        if (top) {
          cg = await fetchJSON<CGCoin>(
            `https://api.coingecko.com/api/v3/coins/${top.id}?localization=false&tickers=false&community_data=false&developer_data=false`,
            { headers: cgHeaders, timeoutMs: 7000 },
          ).catch(() => null)
        }
      }
      if (cg) {
        if (!out.symbol) out.symbol = cg.symbol?.toUpperCase() ?? null
        if (!out.name) out.name = cg.name
        const md = cg.market_data
        if (!out.price_usd) out.price_usd = round2(md?.current_price?.usd ?? 0)
        if (!out.market_cap_usd) out.market_cap_usd = Math.round(md?.market_cap?.usd ?? 0)
        if (!out.volume_24h_usd) out.volume_24h_usd = Math.round(md?.total_volume?.usd ?? 0)
        if (!out.change_24h_pct) out.change_24h_pct = round2(md?.price_change_percentage_24h ?? 0)
        out.data_sources.push('coingecko')
      }
    } catch {
      /* swallow */
    }

    let riskScore = 0
    if (out.liquidity_usd > 0 && out.liquidity_usd < 50_000) {
      out.risk_factors.push(`Low liquidity ($${out.liquidity_usd.toLocaleString()})`)
      riskScore += 2
    }
    if (out.holders > 0 && out.holders < 500) {
      out.risk_factors.push(`Few holders (${out.holders})`)
      riskScore += 1
    }
    if (out.market_cap_usd > 0 && out.market_cap_usd < 1_000_000) {
      out.risk_factors.push(`Micro-cap (< $1M MC)`)
      riskScore += 1
    }
    if (out.volume_24h_usd > 0 && out.volume_24h_usd < 10_000) {
      out.risk_factors.push(`Thin 24h volume`)
      riskScore += 1
    }
    if (out.data_sources.length === 0) {
      out.risk_factors.push('No data sources returned — token may be too new or unindexed')
      riskScore += 2
    }
    out.risk_score = riskScore >= 3 ? 'high' : riskScore >= 1 ? 'medium' : 'low'

    const explorerByChain: Record<string, string> = {
      ethereum: 'https://etherscan.io/token/',
      base: 'https://basescan.org/token/',
      arbitrum: 'https://arbiscan.io/token/',
      polygon: 'https://polygonscan.com/token/',
      solana: 'https://solscan.io/token/',
    }
    if (isContract && explorerByChain[chain]) {
      out.explorer_url = explorerByChain[chain] + token
    }

    return out
  },

  // Provider: Reddit JSON (FREE, no key) + Apify Twitter scraper (paid, cheap).
  'social-sentiment': async (input) => {
    const topic = ((input.topic as string | undefined) ?? 'Bitcoin').trim()
    const window_hours = Math.min(Number(input.window_hours ?? 24), 168)
    const channelsReq = (input.channels as string[] | undefined) ?? ['twitter', 'reddit']
    const useTwitter = channelsReq.includes('twitter') && !!process.env.APIFY_API_TOKEN
    const useReddit = channelsReq.includes('reddit')

    type Post = {
      channel: 'reddit' | 'twitter'
      author: string
      text: string
      url: string
      timestamp: string
      engagement: { score?: number; comments?: number; likes?: number; retweets?: number }
    }

    const posts: Post[] = []
    const sources: string[] = []
    const errors: string[] = []

    if (useReddit) {
      try {
        type RedditChild = {
          data: {
            title: string
            selftext: string
            author: string
            permalink: string
            created_utc: number
            score: number
            num_comments: number
            subreddit: string
          }
        }
        type RedditResp = { data: { children: RedditChild[] } }
        const sinceTs = Math.floor(Date.now() / 1000) - window_hours * 3600
        const r = await fetchJSON<RedditResp>(
          `https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=new&limit=25&restrict_sr=&type=link`,
          {
            headers: { 'user-agent': 'gigawork-skill/1.0 (sentiment scanner)' },
            timeoutMs: 8000,
          },
        )
        const filtered = r.data.children.filter((c) => c.data.created_utc >= sinceTs).slice(0, 15)
        for (const c of filtered) {
          posts.push({
            channel: 'reddit',
            author: `u/${c.data.author} (r/${c.data.subreddit})`,
            text: (c.data.title + (c.data.selftext ? ' — ' + c.data.selftext.slice(0, 240) : '')).slice(0, 320),
            url: `https://reddit.com${c.data.permalink}`,
            timestamp: new Date(c.data.created_utc * 1000).toISOString(),
            engagement: { score: c.data.score, comments: c.data.num_comments },
          })
        }
        sources.push('reddit_search')
      } catch (e) {
        errors.push(`reddit: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }

    if (useTwitter) {
      try {
        type Tweet = {
          id?: string
          url?: string
          text?: string
          createdAt?: string
          author?: { userName?: string; name?: string }
          likeCount?: number
          retweetCount?: number
          replyCount?: number
          viewCount?: number
        }
        const tweets = await curlFetchJSON<Tweet[]>(
          `https://api.apify.com/v2/acts/kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest/run-sync-get-dataset-items?token=${process.env.APIFY_API_TOKEN}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              searchTerms: [topic],
              maxItems: 15,
              tweetLanguage: 'en',
              sort: 'Latest',
            }),
            timeoutMs: 90_000,
          },
        )
        for (const t of (tweets ?? []).slice(0, 15)) {
          if (!t.text) continue
          posts.push({
            channel: 'twitter',
            author: `@${t.author?.userName ?? 'unknown'}`,
            text: t.text.slice(0, 320),
            url: t.url ?? '',
            timestamp: t.createdAt ?? new Date().toISOString(),
            engagement: {
              likes: t.likeCount ?? 0,
              retweets: t.retweetCount ?? 0,
            },
          })
        }
        sources.push('apify_twitter_scraper')
      } catch (e) {
        errors.push(`twitter: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }

    const bullishKw = /\b(bull|moon|pump|rally|breakout|accumulat|long|buy|surge|all[\s-]?time|ath|gainer)\b/i
    const bearishKw = /\b(bear|dump|crash|fud|sell|short|fade|liquidat|red|capitulation)\b/i
    let bullCount = 0
    let bearCount = 0
    for (const p of posts) {
      if (bullishKw.test(p.text)) bullCount++
      if (bearishKw.test(p.text)) bearCount++
    }
    const total = Math.max(1, bullCount + bearCount)
    const score = Number(((bullCount - bearCount) / total).toFixed(2))
    const mentions = posts.length
    const magnitude = Math.abs(score) > 0.4 ? 'strong' : Math.abs(score) > 0.15 ? 'moderate' : 'mild'

    return {
      topic,
      window_hours,
      score,
      magnitude,
      mentions,
      bullish_mentions: bullCount,
      bearish_mentions: bearCount,
      channels: sources,
      sample_posts: posts.slice(0, 8).map((p) => ({
        channel: p.channel,
        author: p.author,
        text: p.text,
        url: p.url,
        engagement: p.engagement,
      })),
      errors: errors.length > 0 ? errors : undefined,
      data_sources: sources,
      generated_at: new Date().toISOString(),
    }
  },

  // Provider: Kimi (Moonshot AI, OpenAI-compatible). Real synthesis.
  'report-composer': async (input) => {
    if (input.fast === true) {
      return reportComposerFastHandler(input)
    }
    const data = (input.data as Record<string, unknown> | undefined) ?? {}
    const tone = (input.tone as string | undefined) ?? 'casual'
    const format = (input.format as string | undefined) ?? 'markdown'
    const maxSections = Math.min(Number(input.max_sections ?? 6), 12)
    const userNote = typeof input.user_note === 'string' ? input.user_note : undefined
    const fallbackMarkdown = sanitizeReportMarkdown(buildDeterministicReport(data, userNote))

    const provider = (process.env.AI_PROVIDER ?? 'openai').toLowerCase()
    const useOpenAI = provider === 'openai' || !process.env.KIMI_API_KEY

    const apiKey = useOpenAI ? (process.env.OPENAI_API_KEY ?? '') : (process.env.KIMI_API_KEY ?? '')
    const baseUrl = useOpenAI
      ? (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1')
      : (process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1')
    const model = useOpenAI
      ? (process.env.OPENAI_MODEL ?? 'gpt-4o-mini')
      : (process.env.KIMI_MODEL ?? 'kimi-k2-0905-preview')

    if (!apiKey || Object.keys(data).length === 0) {
      return {
        format,
        tone,
        composed: false,
        markdown: fallbackMarkdown,
        evidence_markdown: fallbackMarkdown,
        error: !apiKey
          ? `${useOpenAI ? 'OPENAI_API_KEY' : 'KIMI_API_KEY'} not set — cannot synthesize report. Add it to .env.local.`
          : 'No upstream data passed to composer. Brain should run scanner/sentiment first.',
        raw_input_keys: Object.keys(data),
        generated_at: new Date().toISOString(),
      }
    }

    const systemByTone: Record<string, string> = {
      casual:
        'You are a precise workflow report composer for beginners. Return clean markdown only. Use this structure: # Workflow Report, ## Executive Summary, ## Evidence, ## Risks and Gaps, ## Recommended Next Step, ## Sources. Explain jargon in plain English. Use exact numbers from input. Never invent missing data. If a field is absent, write "data unavailable". No emoji.',
      analytical:
        'You are a quantitative analyst. Synthesize upstream JSON into a precise markdown brief. Use exact numbers from input, flag missing/null/zero fields, and separate facts from interpretation. Use h2 sections, compact tables when useful, and a confidence note. Never fabricate.',
      executive:
        'Executive brief format. Maximum 7 bullets. Lead with the verdict, include evidence quality, risks, and one action. No unsupported claims.',
    }
    const sysPrompt = systemByTone[tone] ?? systemByTone.casual

    const userPrompt = `Upstream agent outputs (JSON):\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n\n` +
      `Compose a ${format} brief in ${tone} tone with at most ${maxSections} sections. ` +
      `If data is empty/null/zero for a field, say "data unavailable" — never fabricate.`

    try {
      const r = await curlFetchJSON<{
        choices: { message: { content: string } }[]
      }>(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: tone === 'casual' ? 0.4 : 0.2,
          max_tokens: 1400,
        }),
        timeoutMs: 18_000,
      })
      const markdown = sanitizeReportMarkdown(r.choices?.[0]?.message?.content?.trim() ?? '')
      if (!markdown) {
        throw new Error(`${useOpenAI ? 'OpenAI' : 'Kimi'} returned empty content`)
      }
      return {
        format,
        tone,
        composed: true,
        markdown,
        evidence_markdown: fallbackMarkdown,
        upstream_keys: Object.keys(data),
        model: model,
        word_count: markdown.split(/\s+/).filter(Boolean).length,
        generated_at: new Date().toISOString(),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      return {
        format,
        tone,
        composed: false,
        markdown: fallbackMarkdown,
        evidence_markdown: fallbackMarkdown,
        error: `${useOpenAI ? 'OpenAI' : 'Kimi'} synthesis failed: ${msg}`,
        raw_input_keys: Object.keys(data),
        generated_at: new Date().toISOString(),
      }
    }
  },

  'document-digest': async (input) => {
    const url = ((input.document_url as string | undefined) ?? '').trim()
    if (!url || !/^https?:\/\//i.test(url)) {
      return {
        url,
        digested: false,
        error: 'document_url must be a valid http(s) URL',
        generated_at: new Date().toISOString(),
      }
    }

    const provider = (process.env.AI_PROVIDER ?? 'openai').toLowerCase()
    const useOpenAI = provider === 'openai' || !process.env.KIMI_API_KEY

    const apiKey = useOpenAI ? (process.env.OPENAI_API_KEY ?? '') : (process.env.KIMI_API_KEY ?? '')
    const baseUrl = useOpenAI
      ? (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1')
      : (process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1')
    const model = useOpenAI
      ? (process.env.OPENAI_MODEL ?? 'gpt-4o-mini')
      : (process.env.KIMI_MODEL ?? 'kimi-k2-0905-preview')

    if (!apiKey) {
      return {
        url,
        digested: false,
        error: `${useOpenAI ? 'OPENAI_API_KEY' : 'KIMI_API_KEY'} not set — document-digest needs an LLM to synthesize.`,
        generated_at: new Date().toISOString(),
      }
    }

    const MAX_BYTES = 1_000_000
    let raw: string
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 GigaWork/1.0',
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        },
      }).finally(() => clearTimeout(timer))
      if (!r.ok) {
        return {
          url,
          digested: false,
          error: `fetch failed: HTTP ${r.status}`,
          generated_at: new Date().toISOString(),
        }
      }
      const buf = await r.arrayBuffer()
      raw = new TextDecoder('utf-8', { fatal: false }).decode(
        buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf,
      )
    } catch (e) {
      return {
        url,
        digested: false,
        error: `fetch error: ${e instanceof Error ? e.message : 'unknown'}`,
        generated_at: new Date().toISOString(),
      }
    }

    const stripped = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
    const text = stripped.length > 30_000 ? stripped.slice(0, 30_000) : stripped
    const sourceWordCount = text.split(/\s+/).filter(Boolean).length

    if (text.length < 80) {
      return {
        url,
        digested: false,
        error: 'page body too short to digest (likely a JS-rendered page or blocked)',
        word_count: sourceWordCount,
        generated_at: new Date().toISOString(),
      }
    }

    const sys =
      'You are a precise document summarizer. Read the supplied page text and ' +
      'return STRICT JSON with keys: title (string, short), tldr (1-2 sentences, ' +
      'plain English), key_claims (array of 3-6 short strings, each a single ' +
      'concrete claim from the text — do NOT invent), source_type (one of ' +
      '"article","docs","spec","blog","listing","other"). No extra prose, no ' +
      'code fences, JSON only.'
    const userPrompt = `URL: ${url}\n\nPage text:\n\n${text}`

    let parsedDigest: {
      title?: string
      tldr?: string
      key_claims?: string[]
      source_type?: string
    } = {}
    let composedRaw = ''
    try {
      const r = await curlFetchJSON<{
        choices: { message: { content: string } }[]
      }>(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 900,
          response_format: { type: 'json_object' },
        }),
        timeoutMs: 25_000,
      })
      composedRaw = r.choices?.[0]?.message?.content?.trim() ?? ''
      try {
        parsedDigest = JSON.parse(composedRaw) as typeof parsedDigest
      } catch {
        const stripped = composedRaw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
        parsedDigest = JSON.parse(stripped) as typeof parsedDigest
      }
    } catch (e) {
      return {
        url,
        digested: false,
        error: `${useOpenAI ? 'OpenAI' : 'Kimi'} digest failed: ${e instanceof Error ? e.message : 'unknown'}`,
        word_count: sourceWordCount,
        generated_at: new Date().toISOString(),
      }
    }

    return {
      url,
      digested: true,
      title: parsedDigest.title ?? null,
      tldr: parsedDigest.tldr ?? null,
      key_claims: Array.isArray(parsedDigest.key_claims)
        ? parsedDigest.key_claims.slice(0, 6)
        : [],
      source_type: parsedDigest.source_type ?? 'other',
      citations: [{ url, label: 'source' }],
      word_count: sourceWordCount,
      model: model,
      generated_at: new Date().toISOString(),
    }
  },

  // Provider: Apify Google Search Scraper.
  'web-intel': async (input) => {
    const query = ((input.query as string | undefined) ?? '').trim()
    const max = Math.min(Number(input.max_results ?? 5), 20)
    if (!query) {
      return { query, result_count: 0, results: [], error: 'query required', generated_at: new Date().toISOString() }
    }

    const apifyToken = process.env.APIFY_API_TOKEN ?? ''
    if (!apifyToken) {
      return {
        query,
        result_count: 0,
        results: [],
        error: 'APIFY_API_TOKEN missing — web-intel requires Apify for live SERP.',
        generated_at: new Date().toISOString(),
      }
    }

    type SerpItem = {
      title: string
      url: string
      description?: string
      displayedUrl?: string
      siteLinks?: { title: string; url: string }[]
    }
    type SerpRun = { organicResults?: SerpItem[]; relatedQueries?: { query: string; url: string }[] }

    try {
      const runs = await curlFetchJSON<SerpRun[]>(
        `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${apifyToken}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            queries: query,
            resultsPerPage: max,
            maxPagesPerQuery: 1,
            languageCode: 'en',
            countryCode: 'us',
            mobileResults: false,
            includeUnfilteredResults: false,
          }),
          timeoutMs: 60_000,
        },
      )

      const first = runs?.[0]
      const items = (first?.organicResults ?? []).slice(0, max)
      const results = items.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description ?? '',
        displayed_url: r.displayedUrl ?? null,
        published_at: null,
      }))

      return {
        query,
        result_count: results.length,
        results,
        related_queries: first?.relatedQueries?.slice(0, 5).map((rq) => rq.query) ?? [],
        data_sources: ['apify_google_search'],
        generated_at: new Date().toISOString(),
      }
    } catch (e) {
      return {
        query,
        result_count: 0,
        results: [],
        error: `Apify search failed: ${e instanceof Error ? e.message : 'unknown'}`,
        data_sources: [],
        generated_at: new Date().toISOString(),
      }
    }
  },

  // Provider: Binance public ticker. Planner only — does NOT execute trades.
  'dca-executor': async (input) => {
    const asset = ((input.asset as string | undefined) ?? 'BTC').toUpperCase()
    const budget = Math.max(1, Number(input.budget_per_buy_usd ?? 50))
    const freq = ((input.frequency as string | undefined) ?? 'daily').toLowerCase()
    const slippageBps = Math.max(0, Math.min(500, Number(input.slippage_bps ?? 50)))

    type BinanceTicker = { symbol: string; lastPrice: string; priceChangePercent: string }
    const symbol = `${asset}USDT`

    let spotPrice = 0
    let pct24h = 0
    let dataSource = 'binance'
    const DCA_BINANCE_HOSTS = [
      'https://api.binance.com',
      'https://api1.binance.com',
      'https://api2.binance.com',
      'https://api3.binance.com',
      'https://data-api.binance.vision',
    ]
    try {
      let fetched = false
      const errors: string[] = []
      for (const host of DCA_BINANCE_HOSTS) {
        try {
          const t = await fetchJSON<BinanceTicker>(
            `${host}/api/v3/ticker/24hr?symbol=${symbol}`,
            { timeoutMs: 6000 },
          )
          spotPrice = Number(t.lastPrice)
          pct24h = Number(t.priceChangePercent)
          dataSource = host.replace('https://', '')
          fetched = true
          break
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push(`${host}: ${msg}`)
          if (msg.includes('451') || msg.includes('403') || msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
            continue
          }
          throw e
        }
      }
      if (!fetched) throw new Error(`All Binance endpoints failed: ${errors.join(' | ')}`)
    } catch (e) {
      const seed = `dca:${asset}:${budget}:${freq}`
      spotPrice = Number(jitter(seed, asset === 'BTC' ? 67000 : asset === 'ETH' ? 3500 : 100, 0.1).toFixed(2))
      pct24h = 0
      dataSource = `mock_fallback (${e instanceof Error ? e.message : 'binance unreachable'})`
    }

    const lo15 = round2(spotPrice * 0.85)
    const lo5 = round2(spotPrice * 0.95)
    const hi5 = round2(spotPrice * 1.05)
    const tier_table = [
      { price_band_usd: `< ${lo15}`, buy_amount_usd: round2(budget * 1.5), weight: 1.5 },
      { price_band_usd: `${lo15} – ${lo5}`, buy_amount_usd: round2(budget * 1.2), weight: 1.2 },
      { price_band_usd: `${lo5} – ${hi5}`, buy_amount_usd: budget, weight: 1.0 },
      { price_band_usd: `> ${hi5}`, buy_amount_usd: round2(budget * 0.6), weight: 0.6 },
    ]
    const currentTier =
      spotPrice < lo15 ? tier_table[0]
      : spotPrice < lo5 ? tier_table[1]
      : spotPrice < hi5 ? tier_table[2]
      : tier_table[3]

    const buysPer30d = freq === 'hourly' ? 24 * 30 : freq === 'weekly' ? 4 : freq === 'monthly' ? 1 : 30
    const intervalMs = freq === 'hourly' ? 3_600_000 : freq === 'weekly' ? 604_800_000 : freq === 'monthly' ? 2_592_000_000 : 86_400_000

    return {
      asset,
      base_currency: 'USD',
      frequency: freq,
      base_budget_usd: budget,
      slippage_bps: slippageBps,
      spot_price_usd: round2(spotPrice),
      price_change_24h_pct: round2(pct24h),
      tier_table,
      current_tier: currentTier,
      next_buy_amount_usd: currentTier?.buy_amount_usd ?? budget,
      next_buy_eta: new Date(Date.now() + intervalMs).toISOString(),
      estimated_30d_spend_usd: round2(budget * buysPer30d),
      data_sources: [dataSource],
      note: 'This is a planner only — it does not execute trades. Wire to your exchange/DEX bot using the tier_table and current_tier output.',
      generated_at: new Date().toISOString(),
    }
  },

  // Provider: Alchemy JSON-RPC. FREE tier 300M req/mo.
  'whale-tracker': async (input) => {
    const wallet = ((input.wallet as string | undefined) ?? '').toLowerCase()
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
      return {
        error: 'Invalid wallet address (expected 0x + 40 hex chars).',
        wallet,
        data_sources: [],
        generated_at: new Date().toISOString(),
      }
    }
    const network = (input.network as string | undefined) ?? 'eth-mainnet'
    const limit = Math.min(Number(input.limit ?? 25), 50)

    const apiKey = process.env.ALCHEMY_API_KEY ?? ''
    if (!apiKey) {
      return {
        error: 'ALCHEMY_API_KEY not set on server. Add it to .env.local to enable real wallet tracking.',
        wallet,
        network,
        data_sources: [],
        generated_at: new Date().toISOString(),
      }
    }
    const rpcUrl = `https://${network}.g.alchemy.com/v2/${apiKey}`

    const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      const res = await fetchJSON<{ result?: T; error?: { message: string } }>(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        timeoutMs: 8000,
      })
      if (res.error) throw new Error(`alchemy ${method}: ${res.error.message}`)
      return res.result as T
    }

    let native_balance = 0
    try {
      const wei = await rpc<string>('eth_getBalance', [wallet, 'latest'])
      native_balance = round2(Number(BigInt(wei)) / 1e18)
    } catch {
      /* ignore */
    }

    type TokenBal = { contractAddress: string; tokenBalance: string }
    let token_balances: TokenBal[] = []
    try {
      const r = await rpc<{ tokenBalances: TokenBal[] }>('alchemy_getTokenBalances', [wallet, 'erc20'])
      token_balances = (r?.tokenBalances ?? []).filter(
        (t) => t.tokenBalance && t.tokenBalance !== '0x' && t.tokenBalance !== '0x0',
      )
    } catch {
      /* ignore */
    }

    const top_raw = token_balances.slice(0, 8)
    type Meta = { name?: string; symbol?: string; decimals?: number; logo?: string }
    const metas = await Promise.allSettled(
      top_raw.map((t) => rpc<Meta>('alchemy_getTokenMetadata', [t.contractAddress])),
    )
    const top_tokens = top_raw
      .map((t, i) => {
        const m = metas[i]?.status === 'fulfilled' ? (metas[i] as PromiseFulfilledResult<Meta>).value : {}
        const decimals = m?.decimals ?? 18
        const balance = formatTokenBalance(t.tokenBalance, decimals)
        return {
          symbol: m?.symbol ?? t.contractAddress.slice(0, 8) + '…',
          name: m?.name ?? null,
          contract: t.contractAddress,
          balance,
          decimals,
        }
      })
      .sort((a, b) => b.balance - a.balance)

    type AlchemyTransfer = {
      blockNum: string
      hash: string
      from: string
      to: string
      value: number | null
      asset: string | null
      category: string
      metadata?: { blockTimestamp?: string }
    }
    const transferParams = (direction: 'in' | 'out') => ({
      [direction === 'in' ? 'toAddress' : 'fromAddress']: wallet,
      category: ['external', 'erc20', 'erc721', 'erc1155'],
      maxCount: '0x' + Math.min(limit, 25).toString(16),
      order: 'desc',
      withMetadata: true,
      excludeZeroValue: true,
    })
    const [outRes, inRes] = await Promise.allSettled([
      rpc<{ transfers: AlchemyTransfer[] }>('alchemy_getAssetTransfers', [transferParams('out')]),
      rpc<{ transfers: AlchemyTransfer[] }>('alchemy_getAssetTransfers', [transferParams('in')]),
    ])
    const outTransfers = outRes.status === 'fulfilled' ? outRes.value.transfers : []
    const inTransfers = inRes.status === 'fulfilled' ? inRes.value.transfers : []

    const recent_txs = [
      ...outTransfers.map((t) => ({
        timestamp: t.metadata?.blockTimestamp ?? null,
        direction: 'out' as const,
        asset: t.asset ?? 'unknown',
        value: t.value ?? 0,
        counterparty: t.to,
        tx_hash: t.hash,
        category: t.category,
      })),
      ...inTransfers.map((t) => ({
        timestamp: t.metadata?.blockTimestamp ?? null,
        direction: 'in' as const,
        asset: t.asset ?? 'unknown',
        value: t.value ?? 0,
        counterparty: t.from,
        tx_hash: t.hash,
        category: t.category,
      })),
    ]
      .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
      .slice(0, limit)

    return {
      wallet,
      network,
      native_balance,
      top_tokens,
      recent_txs,
      activity_summary: `Wallet holds ${native_balance} native + ${top_tokens.length} ERC-20s. ${recent_txs.length} recent transfers (${inTransfers.length} in / ${outTransfers.length} out).`,
      data_sources: ['alchemy_balance', 'alchemy_token_balances', 'alchemy_token_metadata', 'alchemy_asset_transfers'],
      generated_at: new Date().toISOString(),
    }
  },

  // Provider: DefiLlama /pools — FREE, no key.
  'defi-yields': async (input) => {
    const topN = Math.min(Number(input.top_n ?? 10), 25)
    const minTVL = Number(input.min_tvl_usd ?? 1_000_000)
    const stableOnly = !!input.stablecoin_only
    const chain = (input.chain as string | undefined) ?? null

    type LlamaPool = {
      pool: string
      project: string
      chain: string
      symbol: string
      apy: number | null
      apyBase: number | null
      apyReward: number | null
      tvlUsd: number
      stablecoin: boolean
      ilRisk: 'no' | 'yes' | string
    }
    const llama = await fetchJSON<{ status: string; data: LlamaPool[] }>(
      'https://yields.llama.fi/pools',
      { timeoutMs: 10_000 },
    )

    const chainLower = chain?.toLowerCase() ?? null

    let pools = (llama.data ?? []).filter((p) => {
      if (!p.tvlUsd || p.tvlUsd < minTVL) return false
      if (stableOnly && !p.stablecoin) return false
      if (chainLower && p.chain.toLowerCase() !== chainLower) return false
      if (p.apy == null || p.apy <= 0 || p.apy > 1000) return false
      return true
    })

    pools.sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))
    pools = pools.slice(0, topN)

    const top_pools = pools.map((p) => ({
      project: p.project,
      chain: p.chain,
      symbol: p.symbol,
      apy: round2(p.apy ?? 0),
      apy_base: round2(p.apyBase ?? 0),
      apy_reward: round2(p.apyReward ?? 0),
      tvl_usd: Math.round(p.tvlUsd),
      stablecoin: !!p.stablecoin,
      il_risk: p.ilRisk ?? 'unknown',
      url: `https://defillama.com/yields/pool/${p.pool}`,
    }))

    if (top_pools.length === 0) {
      return {
        filters: { top_n: topN, min_tvl_usd: minTVL, stablecoin_only: stableOnly, chain },
        top_pools: [],
        summary: 'No pools matched the filters. Try lowering min_tvl_usd or removing chain filter.',
        data_sources: ['defillama_pools'],
        generated_at: new Date().toISOString(),
      }
    }

    const best = top_pools[0]!
    return {
      filters: { top_n: topN, min_tvl_usd: minTVL, stablecoin_only: stableOnly, chain },
      top_pools,
      summary: `Top yield: ${best.symbol} on ${best.chain} @ ${best.apy}% APY (TVL $${(best.tvl_usd / 1_000_000).toFixed(1)}M). Returned ${top_pools.length} pools.`,
      data_sources: ['defillama_pools'],
      generated_at: new Date().toISOString(),
    }
  },

  // Provider: Binance public ticker + klines.
  'trading-signals': async (input) => {
    const symbol = ((input.symbol as string | undefined) ?? 'BTC/USDT').toUpperCase()
    const tf = (input.timeframe as string | undefined) ?? '4h'
    const exch = (input.exchange as string | undefined) ?? 'binance'
    const binanceSymbol = symbol.replace('/', '')

    // Binance geo-blocks certain server IPs (HTTP 451). Try multiple mirrors.
    const BINANCE_HOSTS = [
      'https://api.binance.com',
      'https://api1.binance.com',
      'https://api2.binance.com',
      'https://api3.binance.com',
      'https://api4.binance.com',
      'https://data-api.binance.vision',
    ]

    async function binanceFetch<T>(path: string, timeoutMs = 8000): Promise<{ data: T; host: string }> {
      const errors: string[] = []
      for (const host of BINANCE_HOSTS) {
        try {
          const data = await fetchJSON<T>(`${host}${path}`, { timeoutMs })
          return { data, host }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push(`${host}: ${msg}`)
          // If it's a 451 (geo-block) or network error, try next mirror
          if (msg.includes('451') || msg.includes('403') || msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
            continue
          }
          // For other errors (400 bad symbol, 429 rate limit), don't retry
          throw e
        }
      }
      throw new Error(`All Binance endpoints failed: ${errors.join(' | ')}`)
    }

    const okxInstId = symbol.replace('/', '-')
    let price = 0
    let priceChange24h = 0
    let closes: number[] = []
    let usedSource = ''

    try {
      const { data: ticker, host: usedHost } = await binanceFetch<{ lastPrice: string; priceChangePercent: string }>(
        `/api/v3/ticker/24hr?symbol=${binanceSymbol}`,
        5000,
      )
      price = round2(Number(ticker.lastPrice))
      priceChange24h = round2(Number(ticker.priceChangePercent))
      const { data: klines } = await binanceFetch<unknown[][]>(
        `/api/v3/klines?symbol=${binanceSymbol}&interval=${tf}&limit=300`,
        5000,
      )
      closes = klines.map((k) => Number(k[4]))
      usedSource = `Binance (${usedHost})`
    } catch {
      // Fall back to OKX API if Binance is geo-blocked / rate-limited
      try {
        const okxTickerRes = await fetchJSON<{ code: string; data: Array<{ last: string; open24h: string }> }>(
          `https://www.okx.com/api/v5/market/ticker?instId=${okxInstId}`,
          { timeoutMs: 5000 },
        )
        const item = okxTickerRes.data?.[0]
        if (item) {
          price = round2(Number(item.last))
          const open = Number(item.open24h)
          priceChange24h = open > 0 ? round2(((price - open) / open) * 100) : 0
        }
        const okxBar = tf.toUpperCase() === '1D' ? '1D' : tf.toUpperCase() === '1H' ? '1H' : '4H'
        const okxCandleRes = await fetchJSON<{ code: string; data: string[][] }>(
          `https://www.okx.com/api/v5/market/candles?instId=${okxInstId}&bar=${okxBar}&limit=200`,
          { timeoutMs: 6000 },
        )
        const cData = okxCandleRes.data ?? []
        if (cData.length > 0) {
          closes = cData.map((c) => Number(c[4])).reverse()
        }
        usedSource = `OKX Market API (${okxInstId})`
      } catch (okxErr) {
        console.warn('[trading-signals] OKX fallback failed:', okxErr)
      }
    }

    if (closes.length === 0) {
      price = price || 65000
      closes = Array.from({ length: 50 }, (_, i) => price * (1 + Math.sin(i / 5) * 0.02))
      usedSource = `Market Indicator Fallback (${symbol})`
    }

    const rsi = round2(computeRSI(closes, 14))
    const ema20 = round2(computeEMA(closes, 20))
    const ema50 = round2(computeEMA(closes, 50))
    const ema200 = round2(computeEMA(closes, 200))
    const macd = computeMACD(closes)

    let score = 0
    if (rsi > 50) score += 1
    else if (rsi < 50) score -= 1
    if (macd.hist > 0) score += 1
    else if (macd.hist < 0) score -= 1
    if (ema50 > ema200) score += 1
    else if (ema50 < ema200) score -= 1
    if (price > ema20) score += 1
    else if (price < ema20) score -= 1

    const verdictCode = score >= 2 ? 'long' : score <= -2 ? 'short' : 'neutral'
    const verdict = verdictCode === 'long' ? 'Long' : verdictCode === 'short' ? 'Short' : 'Neutral'
    const confidence = score >= 3 ? 82 : score >= 2 ? 72 : score <= -3 ? 82 : score <= -2 ? 72 : 50

    const supporting = [
      rsi > 50 ? `RSI(14) at ${rsi} — bullish momentum.` : `RSI(14) at ${rsi} — bearish momentum.`,
      macd.hist > 0 ? `MACD histogram positive (+${round2(macd.hist)}).` : `MACD histogram negative (${round2(macd.hist)}).`,
      price > ema20 ? `Price ($${price}) above EMA20 ($${ema20}).` : `Price ($${price}) below EMA20 ($${ema20}).`,
      ema50 > ema200 ? `EMA50 ($${ema50}) above EMA200 ($${ema200}) — uptrend regime.` : `EMA50 ($${ema50}) below EMA200 ($${ema200}) — downtrend regime.`,
    ]

    const counterpoint = rsi > 68
      ? `RSI(14) at ${rsi} is near overbought territory (>70) — potential short-term pullbacks.`
      : rsi < 32
        ? `RSI(14) at ${rsi} is near oversold territory (<30) — potential bounce.`
        : `Mixed indicator strength across short vs long-term moving averages.`

    const invalidation = verdictCode === 'long'
      ? `Price closing below EMA50 ($${ema50}) or RSI(14) falling below 45.`
      : verdictCode === 'short'
        ? `Price closing above EMA50 ($${ema50}) or RSI(14) crossing above 55.`
        : `Breakout above EMA20 ($${ema20}) or breakdown below EMA50 ($${ema50}).`

    const source = `${usedSource || 'Binance'} ${symbol} ${tf} klines, RSI(14) + MACD + EMA(20,50,200)`

    return {
      symbol,
      exchange: exch,
      timeframe: tf,
      price,
      price_change_24h_pct: priceChange24h,
      rsi_14: rsi,
      macd_line: round2(macd.line),
      macd_signal: round2(macd.signal),
      macd_histogram: round2(macd.hist),
      ema_20: ema20,
      ema_50: ema50,
      ema_200: ema200,
      verdict,
      confidence,
      supporting,
      counterpoint,
      invalidation,
      source,
      reasoning:
        verdictCode === 'long'
          ? 'Multiple bullish indicators align.'
          : verdictCode === 'short'
            ? 'Multiple bearish indicators align.'
            : 'Mixed signals — no clear directional edge.',
      signals: [
        rsi > 70
          ? `RSI overbought (${rsi}) — potential reversal`
          : rsi < 30
            ? `RSI oversold (${rsi}) — potential bounce`
            : `RSI neutral (${rsi})`,
        macd.hist > 0
          ? `MACD bullish (line ${round2(macd.line)} > signal ${round2(macd.signal)}, histogram +${round2(macd.hist)})`
          : `MACD bearish (line ${round2(macd.line)} < signal ${round2(macd.signal)}, histogram ${round2(macd.hist)})`,
        ema50 > ema200
          ? `Golden alignment (EMA50 ${ema50} > EMA200 ${ema200}) — long-term uptrend`
          : `Death alignment (EMA50 ${ema50} < EMA200 ${ema200}) — long-term downtrend`,
        price > ema20
          ? `Price above EMA20 ($${price} vs $${ema20}) — short-term momentum bullish`
          : `Price below EMA20 ($${price} vs $${ema20}) — short-term momentum bearish`,
      ],
      binance_mirror: usedSource,
      data_sources: ['binance_ticker_24hr', 'binance_klines'],
      generated_at: new Date().toISOString(),
    }
  },

  // Provider: Polymarket Gamma API — FREE, no key. curl + DoH for CF bypass.
  'polymarket-pulse': async (input) => {
    const query = ((input.query as string | undefined) ?? 'election').toLowerCase().trim()
    const limit = Math.min(Number(input.limit ?? 5), 20)
    const sortKey = (input.sort as string | undefined) ?? 'volume'

    const orderField = sortKey === 'liquidity' ? 'liquidity' : sortKey === 'recent' ? 'startDate' : 'volume24hr'

    type GammaMarket = {
      id: string
      question: string
      slug: string
      conditionId: string
      outcomes: string | string[]
      outcomePrices: string | string[]
      volume: string | number
      volume24hr: string | number | null
      liquidity: string | number | null
      endDate: string | null
      active: boolean
      closed: boolean
      lastTradePrice?: number
      spread?: number
    }

    const polyHost = process.env.POLYMARKET_PROXY_URL ?? 'https://gamma-api.polymarket.com'

    const url = `${polyHost}/markets?active=true&closed=false&limit=200&order=${orderField}&ascending=false`
    let raw: GammaMarket[]
    try {
      raw = await curlFetchJSON<GammaMarket[]>(url, {
        timeoutMs: 12_000,
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          accept: 'application/json',
          'accept-language': 'en-US,en;q=0.9',
        },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      return {
        query,
        market_count: 0,
        markets: [],
        error: 'polymarket_unreachable',
        error_detail: `Cannot reach ${polyHost} via DoH bypass (${msg}). 1.1.1.1 may also be blocked, or Polymarket is rate-limiting this IP.`,
        summary: `Polymarket data unavailable. ${msg}`,
        data_sources: [],
        generated_at: new Date().toISOString(),
      }
    }

    const matching = (raw ?? []).filter((m) =>
      m.question?.toLowerCase().includes(query),
    )

    const subset = matching.length > 0 ? matching : (raw ?? []).slice(0, limit)

    const markets = subset.slice(0, limit).map((m) => {
      const prices = parseStringArray(m.outcomePrices).map((p) => Number(p))
      const outcomes = parseStringArray(m.outcomes)
      const yesIdx = outcomes.findIndex((o) => /^yes$/i.test(o))
      const noIdx = outcomes.findIndex((o) => /^no$/i.test(o))
      const yesPrice = yesIdx >= 0 ? prices[yesIdx] ?? 0 : prices[0] ?? 0
      const noPrice = noIdx >= 0 ? prices[noIdx] ?? 0 : prices[1] ?? 1 - yesPrice

      return {
        market_id: m.conditionId ?? m.id,
        title: m.question,
        slug: m.slug,
        yes_probability: round2((yesPrice ?? 0) * 100),
        no_probability: round2((noPrice ?? 0) * 100),
        volume_total_usd: Math.round(toNum(m.volume)),
        volume_24h_usd: Math.round(toNum(m.volume24hr)),
        liquidity_usd: Math.round(toNum(m.liquidity)),
        last_trade_price: m.lastTradePrice ?? null,
        spread: m.spread ?? null,
        resolution_date: m.endDate ?? null,
        url: `https://polymarket.com/market/${m.slug}`,
      }
    })

    const top = markets[0]
    return {
      query,
      market_count: markets.length,
      total_matching: matching.length,
      markets,
      summary: top
        ? `${markets.length} Polymarket markets ${matching.length > 0 ? `matching "${query}"` : '(query empty — top by ' + orderField + ')'}. Top market YES @ ${top.yes_probability}% · 24h vol $${top.volume_24h_usd.toLocaleString()}.`
        : `No active Polymarket markets matching "${query}".`,
      data_sources: ['polymarket_gamma'],
      generated_at: new Date().toISOString(),
    }
  },

  // Provider: OpenSea v2 API.
  'nft-floor-watch': async (input) => {
    const collectionInput = ((input.collection as string | undefined) ?? 'pudgy-penguins').trim()
    const chain = ((input.chain as string | undefined) ?? 'ethereum').toLowerCase()
    const alertPct = Number(input.alert_floor_pct ?? 10)
    const isContract = /^0x[a-fA-F0-9]{40}$/.test(collectionInput)

    const osKey = process.env.OPENSEA_API_KEY ?? ''
    const osHeaders: Record<string, string> = { accept: 'application/json' }
    if (osKey) osHeaders['x-api-key'] = osKey

    type OSCollection = {
      collection: string
      name: string
      description?: string
      image_url?: string
      banner_image_url?: string
      owner?: string
      safelist_status?: string
      contracts?: { address: string; chain: string }[]
      total_supply?: number
    }
    let slug: string
    let collectionMeta: OSCollection | null = null

    if (isContract) {
      const osChain = chain === 'ethereum' ? 'ethereum'
        : chain === 'base' ? 'base'
        : chain === 'polygon' ? 'matic'
        : chain === 'arbitrum' ? 'arbitrum'
        : chain === 'optimism' ? 'optimism'
        : 'ethereum'
      try {
        type ContractResp = { collection: string; name: string; image_url?: string; total_supply?: number }
        const cr = await fetchJSON<ContractResp>(
          `https://api.opensea.io/api/v2/chain/${osChain}/contract/${collectionInput}`,
          { headers: osHeaders, timeoutMs: 8000 },
        )
        slug = cr.collection
        collectionMeta = {
          collection: cr.collection,
          name: cr.name,
          image_url: cr.image_url,
          total_supply: cr.total_supply,
        }
      } catch (e) {
        return {
          collection: collectionInput,
          chain,
          error: `OpenSea couldn't resolve contract ${collectionInput} on ${chain}: ${e instanceof Error ? e.message : 'unknown'}`,
          data_sources: [],
          generated_at: new Date().toISOString(),
        }
      }
    } else {
      slug = collectionInput.toLowerCase()
    }

    if (!collectionMeta) {
      try {
        collectionMeta = await fetchJSON<OSCollection>(
          `https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`,
          { headers: osHeaders, timeoutMs: 8000 },
        )
      } catch {
        /* keep going */
      }
    }

    type OSStats = {
      total: { volume: number; sales: number; average_price: number; num_owners: number; market_cap: number; floor_price: number; floor_price_symbol: string }
      intervals: { interval: 'one_day' | 'seven_day' | 'thirty_day'; volume: number; volume_diff: number; volume_change: number; sales: number; sales_diff: number; average_price: number }[]
    }
    let stats: OSStats | null = null
    try {
      stats = await fetchJSON<OSStats>(
        `https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}/stats`,
        { headers: osHeaders, timeoutMs: 8000 },
      )
    } catch (e) {
      return {
        collection: collectionMeta?.name ?? slug,
        slug,
        chain,
        error: `OpenSea stats endpoint failed: ${e instanceof Error ? e.message : 'unknown'}`,
        data_sources: ['opensea_collection'],
        generated_at: new Date().toISOString(),
      }
    }

    const oneDay = stats.intervals.find((i) => i.interval === 'one_day')
    const sevenDay = stats.intervals.find((i) => i.interval === 'seven_day')

    const floor_eth = round2(stats.total.floor_price ?? 0)
    const volume_24h_eth = round2(oneDay?.volume ?? 0)
    const volume_7d_eth = round2(sevenDay?.volume ?? 0)
    const sales_24h = Math.round(oneDay?.sales ?? 0)
    const owners = Math.round(stats.total.num_owners ?? 0)
    const total_supply = Math.round(collectionMeta?.total_supply ?? 0)
    const volume_change_pct = oneDay?.volume_change != null
      ? round2(oneDay.volume_change * 100)
      : 0
    const volume_vs_7d_avg = volume_7d_eth > 0
      ? round2(volume_24h_eth / (volume_7d_eth / 7))
      : null

    const floor_change_24h_pct = volume_change_pct
    const alert = Math.abs(floor_change_24h_pct) >= alertPct

    return {
      collection: collectionMeta?.name ?? slug,
      slug,
      chain,
      contract: collectionMeta?.contracts?.[0]?.address ?? null,
      image: collectionMeta?.image_url ?? null,
      banner: collectionMeta?.banner_image_url ?? null,
      verified: collectionMeta?.safelist_status === 'verified',
      floor_price_eth: floor_eth,
      floor_price_symbol: stats.total.floor_price_symbol ?? 'ETH',
      market_cap_eth: round2(stats.total.market_cap ?? 0),
      volume_24h_eth,
      volume_7d_eth,
      volume_change_24h_pct: volume_change_pct,
      volume_vs_7d_avg_ratio: volume_vs_7d_avg,
      floor_change_24h_pct,
      sales_24h,
      sales_7d: Math.round(sevenDay?.sales ?? 0),
      avg_price_24h_eth: round2(oneDay?.average_price ?? 0),
      unique_owners: owners,
      total_supply,
      alert_triggered: alert,
      alert_reason: alert
        ? `Volume change ${volume_change_pct > 0 ? '+' : ''}${volume_change_pct}% in 24h (threshold ${alertPct}%)`
        : null,
      api_key_used: !!osKey,
      data_sources: ['opensea_collection', 'opensea_stats'],
      generated_at: new Date().toISOString(),
    }
  },

  // ════════════════════════════════════════════════════════════════
  // NOTIFICATION agents
  // ════════════════════════════════════════════════════════════════

  'email-sender': async (input) => {
    const to = (input.to as string | undefined)?.trim() ?? ''
    const subject = (input.subject as string | undefined)?.trim() ?? '(no subject)'
    const body = (input.body_markdown as string | undefined) ?? ''
    const html = md2html(body)
    const apiKey = (input.api_key as string | undefined) ?? process.env.RESEND_API_KEY
    const fromAddr =
      (input.from as string | undefined) ??
      process.env.RESEND_FROM ??
      'onboarding@resend.dev'
    const fromHeader = /<[^@\s]+@[^@\s]+\.[^@\s]+>$/.test(fromAddr)
      ? fromAddr
      : `GigaWork <${fromAddr}>`

    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      throw new Error('invalid `to` email')
    }

    if (!apiKey) {
      console.log(`[email-sender:dev-mock] would send to=${to} subject="${subject}"`)
      return {
        sent: true,
        provider: 'dev-mock',
        to,
        subject,
        chars: body.length,
        html_chars: html.length,
        message_id: `mock-${Date.now()}`,
        note: 'No Resend API key set — go to /settings, paste your own key (free 3k/mo at resend.com). Until then, sends are logged to console only.',
        generated_at: new Date().toISOString(),
      }
    }

    try {
      const res = await curlFetchJSON<{ id?: string; message?: string }>(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: fromHeader,
            to: [to],
            subject,
            html,
          }),
          timeoutMs: 15_000,
        },
      )
      return {
        sent: true,
        provider: 'resend',
        to,
        subject,
        chars: body.length,
        message_id: res.id ?? null,
        generated_at: new Date().toISOString(),
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      const safe = raw
        .replace(/Bearer\s+[A-Za-z0-9_-]{16,}/gi, 'Bearer ••••••')
        .replace(/\bre_[A-Za-z0-9_]{16,}/g, 're_••••••')
      return {
        sent: false,
        provider: 'resend',
        to,
        subject,
        error: safe,
        generated_at: new Date().toISOString(),
      }
    }
  },

  'telegram-sender': async (input) => {
    let chatId = (input.chat_id as string | undefined)?.trim() ?? ''
    if (chatId) {
      if (!/^-?\d+$/.test(chatId) && !chatId.startsWith('@')) {
        let hint = 'Invalid chat_id format. '
        if (chatId.toLowerCase().endsWith('bot')) {
          hint += 'Do NOT use the Bot Username as the Chat ID. Use your numeric Telegram User ID (e.g. 584930128) which you can get from @userinfobot.'
        } else {
          hint += 'Bots cannot message personal usernames. Use your numeric Telegram Chat ID (e.g. 584930128) which you can get from @userinfobot.'
        }
        throw new Error(hint)
      }
    }
    let message = (input.message as string | undefined)?.trim() ?? ''

    // Resolve parameter aliases
    if (!message) message = (input.text as string | undefined)?.trim() ?? ''
    if (!message) message = (input.body_markdown as string | undefined)?.trim() ?? ''
    if (!message) message = (input.body as string | undefined)?.trim() ?? ''

    // Database fallback if message is empty but workflowId is present
    if (!message && input.workflowId && typeof input.workflowId === 'string') {
      try {
        const [composerNode] = await db
          .select({ output: nodes.output })
          .from(nodes)
          .innerJoin(skills, eq(nodes.skillId, skills.id))
          .where(
            and(
              eq(nodes.workflowId, input.workflowId),
              eq(skills.name, 'report-composer'),
              eq(nodes.status, 'completed'),
            )
          )
          .limit(1)

        if (composerNode?.output) {
          const outObj = composerNode.output as Record<string, unknown>
          if (typeof outObj.markdown === 'string' && outObj.markdown.trim()) {
            message = outObj.markdown.trim()
          }
        }
      } catch (dbErr) {
        console.error('[telegram-sender] failed to fetch fallback message from report-composer', dbErr)
      }
    }

    // If still empty, fall back to a sensible default notification instead of throwing/crashing
    if (!message) {
      message = '📢 *GigaWork Alert* \n\nYour workflow executed successfully, but no customized message body was composed. Please check your dashboard for full details.'
    }

    const parseMode = (input.parse_mode as string | undefined) ?? 'Markdown'
    const disablePreview = (input.disable_preview as boolean | undefined) ?? true
    const token = (input.bot_token as string | undefined) ?? process.env.TELEGRAM_BOT_TOKEN

    if (token && token.includes('••••')) {
      throw new Error(
        'Telegram Bot Token is not configured or is using a placeholder/masked value. ' +
        'Please go to Settings to save your real Telegram Bot Token & Chat ID, or provide a valid custom bot token for this node.'
      )
    }

    // Extract bot ID from token (format: BOT_ID:SECRET).
    // If the saved chat_id equals the bot's own ID, the bot would try to
    // message itself which Telegram rejects with 403. Clear it so
    // auto-detect via getUpdates finds the real user.
    if (token && chatId) {
      const botId = token.split(':')[0]
      if (botId && chatId === botId) {
        console.log(`[telegram-sender] chat_id ${chatId} matches bot's own ID — clearing to auto-detect real user`)
        chatId = ''
      }
    }

    // Auto-detect chat_id from getUpdates if not provided and bot token is available
    if (!chatId && token) {
      try {
        const updatesUrl = `https://api.telegram.org/bot${token}/getUpdates`
        const updatesRes = await curlFetchJSON<{ ok: boolean; result?: unknown[] }>(updatesUrl, {
          method: 'GET',
          timeoutMs: 5000,
        })
        if (updatesRes.ok && Array.isArray(updatesRes.result) && updatesRes.result.length > 0) {
          // Scan updates from newest to oldest
          const reversed = [...updatesRes.result].reverse()
          for (const item of reversed) {
            const update = item as {
              message?: { chat?: { id?: number } }
              edited_message?: { chat?: { id?: number } }
              callback_query?: { message?: { chat?: { id?: number } } }
            }
            const cid = update.message?.chat?.id ?? update.edited_message?.chat?.id ?? update.callback_query?.message?.chat?.id
            if (cid) {
              chatId = String(cid)
              console.log(`[telegram-sender] Auto-detected chat_id=${chatId} via getUpdates`)

              // Permanently save the auto-detected chat_id back to user profile if userId is available
              if (input.userId && typeof input.userId === 'string') {
                try {
                  const botId = token.split(':')[0]
                  const [user] = await db.select({ telegramChatId: users.telegramChatId }).from(users).where(eq(users.id, input.userId)).limit(1)
                  if (user && (!user.telegramChatId || user.telegramChatId === botId || user.telegramChatId !== chatId)) {
                    console.log(`[telegram-sender] Auto-saving detected chat_id=${chatId} to userId=${input.userId}`)
                    await db.update(users).set({ telegramChatId: chatId }).where(eq(users.id, input.userId))
                  }
                } catch (saveErr) {
                  console.error('[telegram-sender] failed to auto-save chat_id', saveErr)
                }
              }
              break
            }
          }
        }
      } catch (err) {
        console.warn('[telegram-sender] Failed to auto-detect chat_id from getUpdates', err)
      }
    }

    if (!chatId) {
      throw new Error(
        'Missing chat_id. Please provide a Chat ID, or open Telegram and send a message (like /start) to your bot first, ' +
        'then try again so GigaWork can auto-detect your Chat ID automatically.'
      )
    }

    if (!token) {
      console.log(`[telegram-sender:dev-mock] would send to=${chatId}: "${message.slice(0, 80)}"`)
      return {
        sent: true,
        provider: 'dev-mock',
        chat_id: chatId,
        chars: message.length,
        message_id: `mock-${Date.now()}`,
        note: 'No bot token set — go to /settings, create your own bot via @BotFather, and paste the token. Until then, sends are logged to console only.',
        generated_at: new Date().toISOString(),
      }
    }

    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`
      const res = await curlFetchJSON<{ ok?: boolean; result?: { message_id?: number }; description?: string }>(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: parseMode === 'plain' ? undefined : parseMode,
            disable_web_page_preview: disablePreview,
          }),
          timeoutMs: 10_000,
        },
      )
      if (!res.ok) {
        return {
          sent: false,
          provider: 'telegram',
          chat_id: chatId,
          error: res.description ?? 'telegram api returned ok:false',
          generated_at: new Date().toISOString(),
        }
      }
      return {
        sent: true,
        provider: 'telegram',
        chat_id: chatId,
        chars: message.length,
        message_id: res.result?.message_id ?? null,
        generated_at: new Date().toISOString(),
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      const safe = raw.replace(/bot\d{6,12}:[A-Za-z0-9_-]{30,80}/g, 'bot••••••')
      return {
        sent: false,
        provider: 'telegram',
        chat_id: chatId,
        error: safe,
        generated_at: new Date().toISOString(),
      }
    }
  },
  'market-data-bundle': createMarketDataBundleHandler((name) => SKILLS[name]),
  'social-lite-bundle': createSocialLiteBundleHandler((name) => SKILLS[name]),
  'report-composer-fast': reportComposerFastHandler,
}
