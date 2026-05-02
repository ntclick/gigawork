import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { skills } from '../lib/db/schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL missing')

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const sql = postgres(url, { prepare: false })
const db = drizzle(sql, { schema: { skills } })

/**
 * GigaWork v2 — agent registry seed.
 *
 * Owner wallet (collects fees from every dispatch): set in `OWNER_WALLET`.
 * Pricing: 8 credits = 0.08 USDC per call (1 USDC = 100 credits).
 *
 * Each manifest entry includes a `provider_apis` array listing the real-world
 * APIs the agent stub PRETENDS to use. To swap mock data for real responses:
 * provision the listed API keys, replace the handler in
 * `app/api/skills/[name]/route.ts` with real calls. Schema stays unchanged.
 */
const OWNER_WALLET = '0x4c77584f57d385e0f2996bd4ff178c93dff034c0'
const COST_CREDITS = 8 // 0.08 USDC

const SEED = [
  // ════════════════════════════════════════════════════════════════
  // EXISTING 5 — research / synthesis
  // ════════════════════════════════════════════════════════════════
  {
    name: 'crypto-scanner',
    manifest: {
      schema_version: '1',
      skill_id: 'crypto-scanner',
      agent_id: 'crypto-scanner-agent',
      display_name: 'Crypto Token Scanner',
      category: 'research',
      best_for_keywords: ['crypto', 'token', 'defi', 'blockchain', 'solana', 'ethereum', 'base'],
      description:
        'Scans on-chain data for a token: price, holders, top holders concentration, recent trades, buy/sell counts. Use BEFORE any composer that produces market reports — composers need real numbers or they hallucinate.',
      input_schema: {
        type: 'object',
        required: ['token_address'],
        properties: {
          token_address: { type: 'string', minLength: 1 },
          chain: {
            type: 'string',
            enum: ['ethereum', 'base', 'arbitrum', 'solana', 'polygon'],
            default: 'ethereum',
          },
        },
      },
      pricing_note: '0.08 USDC per scan · ~5s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['alchemy_holders', 'dexscreener_quote', 'birdeye_token_overview'],
      provider_apis: ['BIRDEYE_API_KEY (paid)', 'COINGECKO_API_KEY (free pro)', 'DEXSCREENER (no key)'],
    },
  },
  {
    name: 'social-sentiment',
    manifest: {
      schema_version: '1',
      skill_id: 'social-sentiment',
      agent_id: 'social-sentiment-agent',
      display_name: 'Social Sentiment Scorer',
      category: 'research',
      best_for_keywords: ['sentiment', 'social', 'buzz', 'twitter', 'x', 'telegram', 'reddit', 'mood'],
      description:
        'Quantifies social-channel sentiment for a topic. Returns score (-1 to +1), volume, and top emotional drivers (FUD/FOMO/skepticism/excitement). Pair with crypto-scanner to flag price–sentiment divergence.',
      input_schema: {
        type: 'object',
        required: ['topic'],
        properties: {
          topic: { type: 'string', minLength: 2 },
          window_hours: { type: 'integer', minimum: 1, maximum: 168, default: 24 },
          channels: {
            type: 'array',
            items: { type: 'string', enum: ['twitter', 'reddit', 'telegram', 'discord'] },
          },
        },
      },
      pricing_note: '0.08 USDC per query · ~6s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['twitter_recent_search', 'reddit_search', 'lunarcrush_metrics'],
      provider_apis: ['APIFY_API_TOKEN (Twitter scraper)', 'REDDIT_OAUTH (free)', 'LUNARCRUSH_KEY (paid)'],
    },
  },
  {
    name: 'web-intel',
    manifest: {
      schema_version: '1',
      skill_id: 'web-intel',
      agent_id: 'web-intel-agent',
      display_name: 'Web Intelligence Gatherer',
      category: 'research',
      best_for_keywords: ['search', 'web', 'news', 'research', 'trending', 'social'],
      description:
        'Searches the web and social channels for recent mentions, news, and sentiment about a topic. Returns ranked sources with timestamps and short summaries. Use this BEFORE narrowing — it is the discovery step.',
      input_schema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 2 },
          max_results: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          freshness_days: { type: 'integer', minimum: 1, maximum: 365, default: 7 },
        },
      },
      pricing_note: '0.08 USDC per query · ~3s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['serper_search', 'tavily_search', 'twitter_recent_search'],
      provider_apis: ['SERPER_API_KEY (free 2.5k/mo)', 'TAVILY_API_KEY (free 1k/mo)', 'APIFY_API_TOKEN'],
    },
  },
  {
    name: 'document-digest',
    manifest: {
      schema_version: '1',
      skill_id: 'document-digest',
      agent_id: 'document-digest-agent',
      display_name: 'Document Digest',
      category: 'synthesis',
      best_for_keywords: ['pdf', 'document', 'whitepaper', 'paper', 'extract', 'digest'],
      description:
        'Reads a PDF or long-form document and produces a structured digest: TL;DR, key claims, citations. Best for whitepapers, research papers, contracts.',
      input_schema: {
        type: 'object',
        required: ['document_url'],
        properties: {
          document_url: { type: 'string', format: 'uri' },
          max_words: { type: 'integer', minimum: 100, maximum: 4000, default: 1200 },
          include_quotes: { type: 'boolean', default: true },
        },
      },
      pricing_note: '0.08 USDC per document · ~15s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['pdf_extract', 'url_fetch'],
      provider_apis: ['DEEPSEEK_API_KEY (LLM)', 'APIFY_API_TOKEN (PDF fetcher) [optional]'],
    },
  },
  {
    name: 'report-composer',
    manifest: {
      schema_version: '1',
      skill_id: 'report-composer',
      agent_id: 'report-composer-agent',
      display_name: 'Report Composer',
      category: 'synthesis',
      best_for_keywords: ['report', 'summary', 'email', 'digest', 'newsletter', 'brief'],
      description:
        'Synthesizes upstream data (token scans, web research, sentiment scores) into a structured report — markdown, HTML email, or JSON sections. Refuses when upstream is empty or all-zeros to prevent hallucinated narratives.',
      input_schema: {
        type: 'object',
        required: ['data', 'format'],
        properties: {
          data: { type: 'object' },
          format: { type: 'string', enum: ['markdown', 'html_email', 'json_sections'] },
          tone: {
            type: 'string',
            enum: ['analytical', 'casual', 'executive'],
            default: 'analytical',
          },
          max_sections: { type: 'integer', minimum: 1, maximum: 12, default: 6 },
        },
      },
      pricing_note: '0.08 USDC per report · ~10s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: [],
      provider_apis: ['DEEPSEEK_API_KEY (LLM)'],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // NEW 6 — execution / on-chain / specialized
  // ════════════════════════════════════════════════════════════════
  {
    name: 'dca-executor',
    manifest: {
      schema_version: '1',
      skill_id: 'dca-executor',
      agent_id: 'dca-executor-agent',
      display_name: 'DCA Executor',
      category: 'execution',
      best_for_keywords: ['dca', 'dollar cost', 'recurring', 'buy', 'schedule', 'recurring buy'],
      description:
        'Plans a Dollar-Cost-Average strategy on a given asset: tier table by price band, frequency, slippage cap. Returns a deterministic execution schedule that downstream skills (or an on-chain executor) can replay.',
      input_schema: {
        type: 'object',
        required: ['asset', 'budget_per_buy_usd'],
        properties: {
          asset: { type: 'string', minLength: 2 },
          budget_per_buy_usd: { type: 'number', minimum: 1 },
          frequency: { type: 'string', enum: ['hourly', 'daily', 'weekly'], default: 'daily' },
          tier_table: { type: 'object' },
          slippage_bps: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
        },
      },
      pricing_note: '0.08 USDC per plan · ~3s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['coingecko_price', 'binance_ticker', 'arc_swap_router'],
      provider_apis: [
        'COINGECKO_API_KEY (free pro)',
        'BINANCE public API (no key for spot ticker)',
        'ARC_RPC + signed tx (for actual swap leg — pluggable)',
      ],
    },
  },
  {
    name: 'whale-tracker',
    manifest: {
      schema_version: '1',
      skill_id: 'whale-tracker',
      agent_id: 'whale-tracker-agent',
      display_name: 'Whale Tracker',
      category: 'on-chain',
      best_for_keywords: ['whale', 'wallet', 'address', 'follow', 'transfer', 'large buy', 'movements'],
      description:
        'Pulls a wallet\'s recent activity: native balance, top ERC-20 holdings, and last N transfers IN/OUT with counterparties. Ideal for tracking known whales or auditing a fund\'s recent moves.',
      input_schema: {
        type: 'object',
        required: ['wallet'],
        properties: {
          wallet: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
          network: {
            type: 'string',
            enum: ['eth-mainnet', 'base-mainnet', 'arb-mainnet', 'polygon-mainnet', 'opt-mainnet'],
            default: 'eth-mainnet',
          },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
      },
      pricing_note: '0.08 USDC per pull · ~4s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['alchemy_get_asset_transfers', 'alchemy_token_balances'],
      provider_apis: ['ALCHEMY_API_KEY (free 300M req/mo)'],
    },
  },
  {
    name: 'defi-yields',
    manifest: {
      schema_version: '1',
      skill_id: 'defi-yields',
      agent_id: 'defi-yields-agent',
      display_name: 'DeFi Yields Ranker',
      category: 'research',
      best_for_keywords: ['yield', 'apy', 'farm', 'lending', 'staking', 'tvl', 'defi'],
      description:
        'Ranks DeFi yield pools by APY across major chains. Filter by stablecoin-only / chain / minimum TVL. Returns top N with project, symbol, APY base+reward, TVL, and IL risk flag.',
      input_schema: {
        type: 'object',
        properties: {
          top_n: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          min_tvl_usd: { type: 'number', minimum: 0, default: 1_000_000 },
          stablecoin_only: { type: 'boolean', default: false },
          chain: { type: 'string' },
        },
      },
      pricing_note: '0.08 USDC per ranking · ~3s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['defillama_pools'],
      provider_apis: ['DefiLlama /pools (FREE, no key required) — https://yields.llama.fi/pools'],
    },
  },
  {
    name: 'trading-signals',
    manifest: {
      schema_version: '1',
      skill_id: 'trading-signals',
      agent_id: 'trading-signals-agent',
      display_name: 'Trading Signals (TA)',
      category: 'analysis',
      best_for_keywords: ['rsi', 'macd', 'ema', 'ta', 'technical', 'indicator', 'signal', 'long', 'short'],
      description:
        'Computes RSI(14), MACD, and EMA(20/50/200) for a trading pair on a chosen timeframe. Returns a long/short/neutral verdict + per-indicator detail + plain-English reasoning.',
      input_schema: {
        type: 'object',
        required: ['symbol'],
        properties: {
          symbol: { type: 'string', pattern: '^[A-Z0-9]{2,10}/[A-Z0-9]{2,10}$' },
          timeframe: { type: 'string', enum: ['15m', '1h', '4h', '1d', '1w'], default: '4h' },
          exchange: { type: 'string', enum: ['binance', 'bybit', 'coinbase', 'kraken'], default: 'binance' },
        },
      },
      pricing_note: '0.08 USDC per snapshot · ~4s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['taapi_bulk', 'binance_ticker'],
      provider_apis: ['TAAPI_KEY (paid — $19/mo basic)', 'BINANCE public ticker (no key)'],
    },
  },
  {
    name: 'polymarket-pulse',
    manifest: {
      schema_version: '1',
      skill_id: 'polymarket-pulse',
      agent_id: 'polymarket-pulse-agent',
      display_name: 'Polymarket Pulse',
      category: 'research',
      best_for_keywords: ['polymarket', 'prediction', 'odds', 'election', 'event', 'market'],
      description:
        'Fetches Polymarket prediction-market odds + 24h volume for a search term. Returns top markets with YES/NO probabilities, price drift, and liquidity. Useful for event-driven trades or news verification.',
      input_schema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 2 },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
          sort: { type: 'string', enum: ['volume', 'liquidity', 'recent'], default: 'volume' },
        },
      },
      pricing_note: '0.08 USDC per query · ~3s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['polymarket_clob_search', 'polymarket_market_book'],
      provider_apis: [
        'Polymarket CLOB API (FREE, public REST) — https://clob.polymarket.com',
        'gamma-api.polymarket.com (FREE) — https://gamma-api.polymarket.com/markets',
      ],
    },
  },
  {
    name: 'nft-floor-watch',
    manifest: {
      schema_version: '1',
      skill_id: 'nft-floor-watch',
      agent_id: 'nft-floor-watch-agent',
      display_name: 'NFT Floor Watch',
      category: 'on-chain',
      best_for_keywords: ['nft', 'floor', 'collection', 'opensea', 'volume', 'rare', 'mint'],
      description:
        'Reads floor price, 24h volume, owner count, and recent sales for an NFT collection (slug or contract). Flags floor moves > X% or volume spikes vs 7d average.',
      input_schema: {
        type: 'object',
        required: ['collection'],
        properties: {
          collection: { type: 'string', minLength: 2 },
          chain: { type: 'string', enum: ['ethereum', 'base', 'polygon'], default: 'ethereum' },
          alert_floor_pct: { type: 'number', minimum: 0, default: 10 },
        },
      },
      pricing_note: '0.08 USDC per query · ~3s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['reservoir_collections', 'reservoir_sales'],
      provider_apis: [
        'Reservoir API (FREE tier 100k req/day) — https://api.reservoir.tools',
        'OpenSea API (paid, optional fallback)',
      ],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // NOTIFICATION agents — push results to user channels
  // ════════════════════════════════════════════════════════════════
  {
    name: 'email-sender',
    manifest: {
      schema_version: '1',
      skill_id: 'email-sender',
      agent_id: 'email-sender-agent',
      display_name: 'Email Sender',
      category: 'notification',
      best_for_keywords: ['email', 'send', 'notify', 'mail', 'inbox', 'alert', 'report'],
      description:
        'Delivers a workflow result to an email inbox via Resend. Accepts a markdown body and converts it to HTML so the recipient sees a formatted report. Best as the final step after report-composer when the user wants the output pushed somewhere.',
      input_schema: {
        type: 'object',
        required: ['to', 'subject', 'body_markdown'],
        properties: {
          to: { type: 'string', format: 'email', description: 'Recipient email address' },
          subject: { type: 'string', minLength: 1, maxLength: 200 },
          body_markdown: { type: 'string', minLength: 1, description: 'Markdown body — converted to HTML for delivery' },
          from_name: { type: 'string', default: 'GigaWork', description: 'Display name for the sender' },
        },
      },
      pricing_note: '0.08 USDC per email · ~2s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['resend_send', 'smtp_fallback'],
      provider_apis: [
        'RESEND_API_KEY (free 3k/mo) — https://resend.com',
        'SMTP fallback if RESEND_API_KEY not set (logs to console for dev)',
      ],
    },
  },
  {
    name: 'telegram-sender',
    manifest: {
      schema_version: '1',
      skill_id: 'telegram-sender',
      agent_id: 'telegram-sender-agent',
      display_name: 'Telegram Sender',
      category: 'notification',
      best_for_keywords: ['telegram', 'tg', 'bot', 'notify', 'push', 'send', 'message', 'alert'],
      description:
        'Pushes a message to a Telegram chat (user, group, or channel) via a bot. Supports Markdown formatting and works well as the last step of a workflow when the user wants signals delivered to their phone.',
      input_schema: {
        type: 'object',
        required: ['chat_id', 'message'],
        properties: {
          chat_id: { type: 'string', description: 'Numeric chat id (user / group) or @channel_username' },
          message: { type: 'string', minLength: 1, maxLength: 4000 },
          parse_mode: { type: 'string', enum: ['Markdown', 'MarkdownV2', 'HTML', 'plain'], default: 'Markdown' },
          disable_preview: { type: 'boolean', default: true },
        },
      },
      pricing_note: '0.08 USDC per message · ~1s p50',
      cost_credits: COST_CREDITS,
      owner_wallet: OWNER_WALLET,
      tools_available: ['telegram_bot_sendMessage'],
      provider_apis: [
        'TELEGRAM_BOT_TOKEN — create via @BotFather (free, no rate limit for normal use)',
      ],
    },
  },
] as const

async function main() {
  for (const row of SEED) {
    await db
      .insert(skills)
      .values({
        name: row.name,
        manifest: row.manifest,
        endpoint: `${appUrl}/api/skills/${row.name}`,
      })
      .onConflictDoUpdate({
        target: skills.name,
        set: {
          manifest: row.manifest,
          endpoint: `${appUrl}/api/skills/${row.name}`,
        },
      })
    console.log(`✓ ${row.name}  ·  owner ${(row.manifest as { owner_wallet: string }).owner_wallet}  ·  ${row.manifest.cost_credits}cr`)
  }
  console.log(`\n✅ Seeded ${SEED.length} skills (owner = 0x4c77…34c0, 0.08 USDC each)`)
  await sql.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
