/**
 * scripts/reprice-skills.ts — set per-skill x402 prices by real cost.
 *
 * Everything used to be a flat 8 (= $0.08) whether the agent made one
 * cheap REST call or ran an LLM synthesis, which made a 3-agent workflow
 * cost $0.24 + $0.05 escrow. Prices now track what a call actually costs
 * us to serve.
 *
 * `manifest.cost_credits` is an integer in HUNDREDTHS OF A DOLLAR — the
 * executor divides it by 100 to charge the user's USDC vault. 1 is the
 * smallest expressible price ($0.01).
 *
 * Usage: tsx scripts/reprice-skills.ts [--dry-run]
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const DRY = process.argv.includes('--dry-run')

/** slug → cost_credits (hundredths of a dollar) */
const PRICES: Record<string, number> = {
  // Plain REST lookups — one upstream call, no model inference.
  'defi-yields': 1,
  'crypto-scanner': 1,
  'trading-signals': 1,
  'whale-tracker': 1,
  'nft-floor-watch': 1,
  'polymarket-pulse': 1,
  'wallet-risk-checker': 1,
  'dca-executor': 1,
  // Outbound notifications — cheap, but not free (provider quota).
  'email-sender': 1,
  'telegram-sender': 1,
  // Multi-source fan-out: several upstream calls per invocation.
  'market-data-bundle': 3,
  'social-lite-bundle': 2,
  'social-sentiment': 2,
  'web-intel': 2,
  'document-digest': 2,
  // LLM synthesis — the only genuinely expensive calls.
  'report-composer': 3,
  'report-composer-fast': 2,
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false })
  const rows = await sql<{ id: string; name: string; manifest: Record<string, unknown> }[]>`
    SELECT id, name, manifest FROM skills
  `

  let changed = 0
  let before = 0
  let after = 0

  for (const r of rows) {
    const current = Number((r.manifest as Record<string, unknown>)?.cost_credits ?? 0)
    const next = PRICES[r.name]
    before += current
    after += next ?? current
    if (next === undefined) {
      console.log(`  ${r.name.padEnd(22)} ${String(current).padStart(3)} → (no price defined, left alone)`)
      continue
    }
    if (next === current) continue
    changed++
    console.log(
      `  ${r.name.padEnd(22)} $${(current / 100).toFixed(2)} → $${(next / 100).toFixed(2)}`,
    )
    if (!DRY) {
      await sql`
        UPDATE skills
        SET manifest = jsonb_set(manifest, '{cost_credits}', ${String(next)}::jsonb)
        WHERE id = ${r.id}
      `
    }
  }

  console.log('')
  console.log(`skills repriced : ${changed}`)
  console.log(`catalogue total : $${(before / 100).toFixed(2)} → $${(after / 100).toFixed(2)}`)
  if (DRY) console.log('\nDry run — nothing written. Re-run without --dry-run to apply.')

  await sql.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
