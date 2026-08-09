/**
 * add-vault-cols.ts — add real per-user custodial vault columns.
 *
 *   - vault_wallet_id       → encrypted private key (v1: envelope, see
 *                             lib/crypto/walletEncryption.ts)
 *   - vault_address         → real public address (replaces the old fake
 *                             getDedicatedVaultAddress() hash)
 *   - vault_provisioned_at  → set once, on first provisioning
 *
 * Idempotent (IF NOT EXISTS). Run via `pnpm db:add-vault-cols`.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { prepare: false })

async function main() {
  console.log('① Adding vault_wallet_id column…')
  await sql.unsafe(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS vault_wallet_id text
  `)
  console.log('   ✓')

  console.log('② Adding vault_address column…')
  await sql.unsafe(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS vault_address text
  `)
  console.log('   ✓')

  console.log('③ Adding unique index on vault_address…')
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_vault_address_unique
    ON users (vault_address)
    WHERE vault_address IS NOT NULL
  `)
  console.log('   ✓')

  console.log('④ Adding vault_provisioned_at column…')
  await sql.unsafe(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS vault_provisioned_at timestamp with time zone
  `)
  console.log('   ✓')

  console.log('⑤ Updating usdc_balance default (was fake $10.00 → real $0.00)…')
  await sql.unsafe(`
    ALTER TABLE users
    ALTER COLUMN usdc_balance SET DEFAULT '0.00'
  `)
  console.log('   ✓ (existing rows untouched — see scripts/backfill-vault-balances.ts)')

  await sql.end()
  console.log('\n✅ Vault columns ready.')
}

main().catch((e) => { console.error(e); process.exit(1) })
