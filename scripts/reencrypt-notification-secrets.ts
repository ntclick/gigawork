/**
 * scripts/reencrypt-notification-secrets.ts
 *
 * One-shot migration: encrypts any users.email_api_key /
 * users.telegram_bot_token rows still stored in plaintext. Companion to
 * scripts/reencrypt-agent-wallets.ts (which did the same for wallet
 * private keys) — see lib/notifications/secrets.ts for the read/write
 * chokepoint that stops new writes from being plaintext.
 *
 * Idempotent — values already in the `v1:` envelope format are skipped,
 * so re-running is safe.
 *
 * Usage:
 *   tsx scripts/reencrypt-notification-secrets.ts --dry-run   # preview
 *   tsx scripts/reencrypt-notification-secrets.ts             # apply
 *
 * Requires WALLET_ENCRYPTION_KEY to be set (same key as the running app).
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

/** Show enough to identify the row without dumping the secret itself. */
function preview(secret: string): string {
  if (secret.length <= 8) return `${'*'.repeat(secret.length)}`
  return `${secret.slice(0, 4)}…${secret.slice(-4)} (len ${secret.length})`
}

async function main() {
  console.log(
    `Scanning users.email_api_key + users.telegram_bot_token for plaintext${DRY_RUN ? ' (dry run)' : ''}...`,
  )

  const rows = await sql<
    { id: string; wallet: string; email_api_key: string | null; telegram_bot_token: string | null }[]
  >`
    SELECT id, wallet, email_api_key, telegram_bot_token
    FROM users
    WHERE email_api_key IS NOT NULL OR telegram_bot_token IS NOT NULL
  `

  let emailPlain = 0
  let telegramPlain = 0
  let alreadyEncrypted = 0
  let errors = 0

  for (const row of rows) {
    const patch: { email_api_key?: string; telegram_bot_token?: string } = {}

    if (row.email_api_key) {
      if (isEncrypted(row.email_api_key)) {
        alreadyEncrypted++
      } else {
        emailPlain++
        console.log(`  user ${row.id} (${row.wallet}) — plaintext email_api_key ${preview(row.email_api_key)}`)
        if (!DRY_RUN) patch.email_api_key = encryptSecret(row.email_api_key)
      }
    }

    if (row.telegram_bot_token) {
      if (isEncrypted(row.telegram_bot_token)) {
        alreadyEncrypted++
      } else {
        telegramPlain++
        console.log(
          `  user ${row.id} (${row.wallet}) — plaintext telegram_bot_token ${preview(row.telegram_bot_token)}`,
        )
        if (!DRY_RUN) patch.telegram_bot_token = encryptSecret(row.telegram_bot_token)
      }
    }

    if (DRY_RUN || Object.keys(patch).length === 0) continue

    try {
      if (patch.email_api_key && patch.telegram_bot_token) {
        await sql`UPDATE users SET email_api_key = ${patch.email_api_key}, telegram_bot_token = ${patch.telegram_bot_token} WHERE id = ${row.id}`
      } else if (patch.email_api_key) {
        await sql`UPDATE users SET email_api_key = ${patch.email_api_key} WHERE id = ${row.id}`
      } else {
        await sql`UPDATE users SET telegram_bot_token = ${patch.telegram_bot_token!} WHERE id = ${row.id}`
      }
      console.log(`    ✓ encrypted`)
    } catch (e) {
      errors++
      console.error(`    ✗ failed for user ${row.id}:`, e instanceof Error ? e.message : e)
    }
  }

  console.log('')
  console.log(`Rows with at least one secret:  ${rows.length}`)
  console.log(`Already encrypted (values):     ${alreadyEncrypted}`)
  console.log(`Plaintext email_api_key:        ${emailPlain}`)
  console.log(`Plaintext telegram_bot_token:   ${telegramPlain}`)
  if (DRY_RUN) {
    console.log(`\nDry run — no changes written. Re-run without --dry-run to encrypt these rows.`)
  } else {
    console.log(`Errors:                         ${errors}`)
  }

  await sql.end()
  if (errors > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
