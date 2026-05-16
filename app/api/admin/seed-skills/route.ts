/**
 * /api/admin/seed-skills — POST to seed (or refresh) the 13 v2 skills.
 *
 * Re-uses the SEED array from scripts/seed-skills.ts so production stays
 * in lock-step with what `pnpm db:seed` would write locally. Auth gate is
 * an X-Migrate-Token header that defaults to 'dev-migrate' if MIGRATE_TOKEN
 * is unset (matches /api/admin/migrate). Idempotent — onConflictDoUpdate
 * keeps existing rows fresh on every call.
 */
import { NextResponse } from 'next/server'

import { db } from '@/lib/db/client'
import { skills } from '@/lib/db/schema'

import { privateKeyToAccount } from 'viem/accounts'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://gigawork.xyz'
// Skill metadata.owner_wallet — derive from ADMIN_PRIVATE_KEY so the
// off-chain manifest agrees with on-chain `ownerOf(agentTokenId)` after
// `mint-agents.ts` runs (admin calls register() → mints to msg.sender =
// admin). The previous hardcoded `0x4c7758...` was a leftover dev
// wallet — see transfer-agents.ts header for the cleanup story.
const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY as `0x${string}` | undefined
const OWNER_WALLET = (process.env.SKILL_OWNER_WALLET ??
  (ADMIN_PK ? privateKeyToAccount(ADMIN_PK).address : '0x0000000000000000000000000000000000000000')).toLowerCase()
const COST = 8

type Manifest = Record<string, unknown>

// Compact manifest list — same skill set as scripts/seed-skills.ts but
// trimmed to the fields the UI + brain actually read at runtime.
const SEED: Array<{ name: string; manifest: Manifest }> = [
  {
    name: 'crypto-scanner',
    manifest: {
      schema_version: '1',
      display_name: 'Crypto Token Scanner',
      category: 'research',
      description: 'Scan on-chain stats for a token: price, holders, recent trades.',
      best_for_keywords: ['crypto', 'token', 'defi', 'ethereum', 'solana', 'base'],
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
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'social-sentiment',
    manifest: {
      schema_version: '1',
      display_name: 'Social Sentiment Scorer',
      category: 'research',
      description: 'Quantify Twitter / Reddit sentiment for any topic.',
      best_for_keywords: ['sentiment', 'social', 'twitter', 'reddit'],
      input_schema: {
        type: 'object',
        required: ['topic'],
        properties: {
          topic: { type: 'string', minLength: 2 },
          window_hours: { type: 'integer', minimum: 1, maximum: 168, default: 24 },
          channels: {
            type: 'array',
            items: { type: 'string', enum: ['twitter', 'reddit'] },
            default: ['twitter', 'reddit'],
          },
        },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'report-composer',
    manifest: {
      schema_version: '1',
      display_name: 'Report Composer (Kimi K2)',
      category: 'synthesis',
      description: 'Synthesize upstream data into a beginner-friendly markdown brief.',
      best_for_keywords: ['report', 'compose', 'summary', 'verdict'],
      input_schema: {
        type: 'object',
        required: ['data'],
        properties: {
          data: { type: 'object' },
          tone: { type: 'string', enum: ['casual', 'analytical', 'executive'], default: 'casual' },
          format: { type: 'string', enum: ['markdown'], default: 'markdown' },
        },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'document-digest',
    manifest: {
      schema_version: '1',
      display_name: 'Document Digest',
      category: 'research',
      description: 'Fetch a URL, strip HTML, summarize via Kimi K2 (title / TLDR / key claims).',
      best_for_keywords: ['document', 'whitepaper', 'article', 'digest', 'tldr'],
      input_schema: {
        type: 'object',
        required: ['document_url'],
        properties: { document_url: { type: 'string', minLength: 8 } },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'web-intel',
    manifest: {
      schema_version: '1',
      display_name: 'Web Research',
      category: 'research',
      description: 'Live Google SERP via Apify; returns top organic results with snippets.',
      best_for_keywords: ['web', 'search', 'google', 'news', 'research'],
      input_schema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 2 },
          max_results: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
        },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'dca-executor',
    manifest: {
      schema_version: '1',
      display_name: 'DCA Planner',
      category: 'execution',
      description:
        'Plan a tiered dollar-cost-average around live spot price (Binance ticker). Does NOT place trades.',
      best_for_keywords: ['dca', 'schedule', 'plan', 'buy', 'tier'],
      input_schema: {
        type: 'object',
        required: ['asset'],
        properties: {
          asset: { type: 'string', minLength: 2, default: 'BTC' },
          budget_per_buy_usd: { type: 'number', minimum: 1, default: 50 },
          frequency: {
            type: 'string',
            enum: ['hourly', 'daily', 'weekly', 'monthly'],
            default: 'daily',
          },
          slippage_bps: { type: 'integer', minimum: 0, maximum: 500, default: 50 },
        },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'whale-tracker',
    manifest: {
      schema_version: '1',
      display_name: 'Whale Tracker',
      category: 'on-chain',
      description: 'Pull native + ERC-20 balances and recent transfers for a wallet via Alchemy.',
      best_for_keywords: ['whale', 'wallet', 'transfers', 'balance'],
      input_schema: {
        type: 'object',
        required: ['wallet'],
        properties: {
          wallet: { type: 'string', minLength: 42 },
          network: { type: 'string', default: 'eth-mainnet' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
        },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'defi-yields',
    manifest: {
      schema_version: '1',
      display_name: 'DeFi Yield Finder',
      category: 'research',
      description: 'Rank yield-farming opportunities from DefiLlama (free, no key).',
      best_for_keywords: ['yield', 'apy', 'defi', 'farm', 'stablecoin'],
      input_schema: {
        type: 'object',
        properties: {
          top_n: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          min_tvl_usd: { type: 'number', minimum: 0, default: 1_000_000 },
          stablecoin_only: { type: 'boolean', default: false },
        },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'trading-signals',
    manifest: {
      schema_version: '1',
      display_name: 'Trading Signals',
      category: 'analysis',
      description: 'RSI / MACD / EMA from Binance public ticker, plus long/short/neutral verdict.',
      best_for_keywords: ['trading', 'signals', 'rsi', 'macd', 'ta', 'technical'],
      input_schema: {
        type: 'object',
        required: ['symbol'],
        properties: {
          symbol: { type: 'string', minLength: 3, default: 'BTC/USDT' },
          timeframe: { type: 'string', enum: ['1h', '4h', '1d'], default: '4h' },
          exchange: { type: 'string', default: 'binance' },
        },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'polymarket-pulse',
    manifest: {
      schema_version: '1',
      display_name: 'Polymarket Pulse',
      category: 'research',
      description: 'Top markets matching a query: YES/NO probabilities + 24h volume.',
      best_for_keywords: ['polymarket', 'prediction', 'odds', 'market'],
      input_schema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 2 },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
        },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'nft-floor-watch',
    manifest: {
      schema_version: '1',
      display_name: 'NFT Floor Watch',
      category: 'on-chain',
      description: 'Floor price, 24h volume, owners on a collection (OpenSea v2).',
      best_for_keywords: ['nft', 'floor', 'collection', 'opensea'],
      input_schema: {
        type: 'object',
        required: ['collection'],
        properties: {
          collection: { type: 'string', minLength: 1 },
          chain: { type: 'string', default: 'ethereum' },
        },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'email-sender',
    manifest: {
      schema_version: '1',
      display_name: 'Email Sender',
      category: 'execution',
      description: 'Send a markdown email via the user\'s saved Resend API key.',
      best_for_keywords: ['email', 'send', 'notify', 'resend'],
      input_schema: {
        type: 'object',
        required: ['subject', 'body_markdown'],
        properties: {
          to: { type: 'string' },
          subject: { type: 'string', minLength: 1 },
          body_markdown: { type: 'string', minLength: 1 },
        },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
  {
    name: 'telegram-sender',
    manifest: {
      schema_version: '1',
      display_name: 'Telegram Sender',
      category: 'execution',
      description: 'Push a message via the user\'s saved bot token (set in /settings).',
      best_for_keywords: ['telegram', 'tg', 'notify', 'bot'],
      input_schema: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', minLength: 1 },
          parse_mode: { type: 'string', enum: ['Markdown', 'HTML', 'plain'], default: 'Markdown' },
        },
      },
      cost_credits: COST,
      owner_wallet: OWNER_WALLET,
    },
  },
]

export async function POST(req: Request) {
  const guard = req.headers.get('x-migrate-token') ?? ''
  if (guard !== (process.env.MIGRATE_TOKEN ?? 'dev-migrate')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const seeded: string[] = []
  for (const row of SEED) {
    await db
      .insert(skills)
      .values({
        name: row.name,
        manifest: row.manifest,
        endpoint: `${APP_URL}/api/skills/${row.name}`,
      })
      .onConflictDoUpdate({
        target: skills.name,
        set: {
          manifest: row.manifest,
          endpoint: `${APP_URL}/api/skills/${row.name}`,
        },
      })
    seeded.push(row.name)
  }

  return NextResponse.json({ ok: true, seeded, count: seeded.length })
}
