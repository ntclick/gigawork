/**
 * scripts/reencrypt-agent-wallets.ts
 *
 * One-shot migration: encrypts any `agents.wallet_id` rows still stored
 * in plaintext (legacy — see lib/crypto/walletEncryption.ts for the fix
 * that stops new writes from being plaintext). Idempotent — rows already
 * in the `v1:` envelope format are skipped, so re-running is safe.
 *
 * Usage:
 *   tsx scripts/reencrypt-agent-wallets.ts --dry-run   # preview only
 *   tsx scripts/reencrypt-agent-wallets.ts             # write for real
 *
 * Requires WALLET_ENCRYPTION_KEY to be set (same as the running app).
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'
import { encryptSecret, isEncrypted } from '../lib/crypto/walletEncryption'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL missing')

const DRY_RUN = process.argv.includes('--dry-run')

const sql = postgres(url, { prepare: false })

async function main() {
  console.log(`Scanning agents.wallet_id for plaintext keys${DRY_RUN ? ' (dry run)' : ''}...`)

  const rows = await sql<{ id: string; wallet_address: string; wallet_id: string | null }[]>`
    SELECT id, wallet_address, wallet_id FROM agents WHERE wallet_id IS NOT NULL
  `

  let plaintextCount = 0
  let alreadyEncryptedCount = 0
  let errorCount = 0

  for (const row of rows) {
    if (!row.wallet_id) continue

    if (isEncrypted(row.wallet_id)) {
      alreadyEncryptedCount++
      continue
    }

    plaintextCount++
    console.log(`  agent ${row.id} (${row.wallet_address}) — plaintext key found`)

    if (DRY_RUN) continue

    try {
      const encrypted = encryptSecret(row.wallet_id)
      await sql`UPDATE agents SET wallet_id = ${encrypted} WHERE id = ${row.id}`
      console.log(`    ✓ re-encrypted`)
    } catch (e) {
      errorCount++
      console.error(`    ✗ failed to re-encrypt agent ${row.id}:`, e instanceof Error ? e.message : e)
    }
  }

  console.log('')
  console.log(`Total rows scanned:      ${rows.length}`)
  console.log(`Already encrypted:       ${alreadyEncryptedCount}`)
  console.log(`Plaintext found:         ${plaintextCount}`)
  if (DRY_RUN) {
    console.log(`\nDry run — no changes written. Re-run without --dry-run to encrypt these rows.`)
  } else {
    console.log(`Re-encrypted:            ${plaintextCount - errorCount}`)
    console.log(`Errors:                  ${errorCount}`)
  }

  await sql.end()
  if (errorCount > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
