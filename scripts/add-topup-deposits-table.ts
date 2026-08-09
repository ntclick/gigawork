/**
 * add-topup-deposits-table.ts — creates the topup_deposits table.
 *
 * Discovered missing while working on the vault architecture: schema.ts
 * has defined `topupDeposits` (and lib/payments/depositVault.ts's
 * depositUsdcBalance() has relied on its UNIQUE tx_hash constraint for
 * replay protection) since the usdc_balance column was introduced, but
 * no migration ever created the actual table — so every insert attempt
 * has been silently failing (caught, logged as a warning, swallowed)
 * and REPLAY PROTECTION FOR USDC TOP-UPS HAS BEEN NON-FUNCTIONAL. The
 * same tx_hash could be submitted to /api/me/topup repeatedly and
 * credited every time. (The older, separate `credit_ledger.tx_hash`
 * unique constraint — a different system — was fine; see
 * add-topup-uniq.ts.)
 *
 * Idempotent (IF NOT EXISTS). Run via `pnpm db:add-topup-deposits`.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { prepare: false })

async function main() {
  console.log('① Creating topup_deposits table…')
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS topup_deposits (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tx_hash text NOT NULL UNIQUE,
      amount_usdc numeric NOT NULL,
      reason text NOT NULL DEFAULT 'topup_onchain',
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `)
  console.log('   ✓')

  console.log('② Creating index on tx_hash…')
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS topup_deposits_tx_hash_idx ON topup_deposits (tx_hash)
  `)
  console.log('   ✓')

  await sql.end()
  console.log('\n✅ topup_deposits table ready — USDC top-up replay protection is now real.')
}

main().catch((e) => { console.error(e); process.exit(1) })
