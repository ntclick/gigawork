/**
 * lib/notifications/secrets.ts
 *
 * Encryption-at-rest for the two user-supplied notification credentials
 * stored on the `users` table:
 *   - users.email_api_key      (the user's own Resend API key)
 *   - users.telegram_bot_token (the user's own @BotFather bot token)
 *
 * Both used to be written and read back in PLAINTEXT — the same class of
 * exposure as the agent/vault wallet private keys fixed in
 * lib/crypto/walletEncryption.ts, which this module reuses. Anyone with
 * DB read access could previously send mail as the user or take over
 * their Telegram bot.
 *
 * This module is the single chokepoint. Every read site must run the
 * selected row through `decryptProfileSecrets()`; every write site must
 * run the value through `encryptProfileSecret()`.
 *
 * Rollout is gradual-safe: `decryptSecret` passes non-enveloped (legacy
 * plaintext) values through unchanged, so rows migrated by
 * scripts/reencrypt-notification-secrets.ts and rows not yet migrated
 * both work.
 *
 * Decryption here is deliberately FAULT-TOLERANT (unlike wallet keys,
 * where a bad key must fail loudly before signing): a corrupted envelope
 * degrades to "channel not configured" — the user misses a notification
 * — rather than throwing and killing the workflow that was trying to
 * notify them.
 */
import { decryptSecret, encryptSecretIfNeeded } from '@/lib/crypto/walletEncryption'

export interface ProfileSecrets {
  emailApiKey?: string | null
  telegramBotToken?: string | null
}

function safeDecrypt(value: string | null | undefined, label: string): string | null {
  if (!value) return null
  try {
    return decryptSecret(value)
  } catch (e) {
    console.error(
      `[notifications/secrets] failed to decrypt ${label} — treating as unconfigured:`,
      e instanceof Error ? e.message : e,
    )
    return null
  }
}

/**
 * Returns a copy of a selected profile row with its notification
 * secrets decrypted. Pass the result of your `db.select({...})` straight
 * through this before using `emailApiKey` / `telegramBotToken`.
 */
export function decryptProfileSecrets<T extends ProfileSecrets>(profile: T): T
export function decryptProfileSecrets<T extends ProfileSecrets>(
  profile: T | null | undefined,
): T | null
export function decryptProfileSecrets<T extends ProfileSecrets>(
  profile: T | null | undefined,
): T | null {
  if (!profile) return null
  return {
    ...profile,
    emailApiKey: safeDecrypt(profile.emailApiKey, 'emailApiKey'),
    telegramBotToken: safeDecrypt(profile.telegramBotToken, 'telegramBotToken'),
  }
}

/**
 * Encrypts a notification secret before it's persisted to the users
 * table. Null/empty passes through (clearing a credential). Already-
 * encrypted values pass through untouched, so re-saving an unrelated
 * profile field never double-encrypts.
 */
export function encryptProfileSecret(value: string | null | undefined): string | null {
  if (!value) return null
  return encryptSecretIfNeeded(value)
}

/**
 * Masks a PLAINTEXT secret for display ("••••••••1234"). Callers must
 * decrypt first — masking the ciphertext envelope would leak the tail of
 * the base64 blob and show a "last 4" the user doesn't recognise.
 *
 * Guards short strings: the previous copy of this logic in /api/me did
 * `'•'.repeat(Math.min(20, len - 4))`, which throws RangeError on any
 * secret shorter than 4 characters.
 */
export function maskSecret(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null
  if (plaintext.length < 8) return '••••'
  return '•'.repeat(Math.min(20, plaintext.length - 4)) + plaintext.slice(-4)
}
