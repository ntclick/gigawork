/**
 * scripts/backfill-vault-balances.ts
 *
 * One-off, operator-run backfill for the fake usdcBalance data that
 * predates the real per-user vault (see lib/payments/vault.ts +
 * lib/db/schema.ts's usdcBalance default change from '10.00' → '0.00').
 *
 * For every user with NO real topupDeposits history — i.e. their
 * current usdcBalance is 100% synthetic dev/demo credit, never backed
 * by an actual on-chain deposit — reset usdcBalance to 0.00. Users who
 * DO have real topupDeposits rows are left untouched (their balance is
 * already reconciled against real funds).
 *
 * This is a judgment call on real user-facing numbers — run --dry-run
 * first and review the affected row count before writing.
 *
 * Usage:
 *   tsx scripts/backfill-vault-balances.ts --dry-run
 *   tsx scripts/backfill-vault-balances.ts
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL missing')

const DRY_RUN = process.argv.includes('--dry-run')

const sql = postgres(url, { prepare: false })

async function main() {
  console.log(`Scanning users for synthetic usdcBalance with no real deposit history${DRY_RUN ? ' (dry run)' : ''}...`)

  const affected = await sql<{ id: string; wallet: string; usdc_balance: string }[]>`
    SELECT u.id, u.wallet, u.usdc_balance
    FROM users u
    WHERE u.usdc_balance::numeric > 0
      AND NOT EXISTS (
        SELECT 1 FROM topup_deposits td WHERE td.user_id = u.id
      )
  `

  const untouched = await sql<{ count: string }[]>`
    SELECT count(*) FROM users u
    WHERE u.usdc_balance::numeric > 0
      AND EXISTS (SELECT 1 FROM topup_deposits td WHERE td.user_id = u.id)
  `

  console.log('')
  for (const row of affected) {
    console.log(`  user ${row.id} (${row.wallet}) — usdc_balance=${row.usdc_balance} → 0.00 (no real deposits)`)
  }

  console.log('')
  console.log(`Users to reset (synthetic balance, no real deposits): ${affected.length}`)
  console.log(`Users left untouched (have real deposit history):     ${untouched[0]?.count ?? 0}`)

  if (DRY_RUN) {
    console.log(`\nDry run — no changes written. Re-run without --dry-run to apply.`)
    await sql.end()
    return
  }

  if (affected.length === 0) {
    console.log('\nNothing to do.')
    await sql.end()
    return
  }

  const ids = affected.map((r) => r.id)
  await sql`UPDATE users SET usdc_balance = '0.00' WHERE id = ANY(${ids})`
  console.log(`\n✅ Reset ${affected.length} user(s) to usdc_balance = 0.00.`)

  await sql.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
