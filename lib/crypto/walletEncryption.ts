/**
 * lib/crypto/walletEncryption.ts
 *
 * Encryption-at-rest for secrets stored in Postgres text columns —
 * primarily agent/vault wallet private keys (`agents.wallet_id`,
 * `users.vault_wallet_id`), which previously were written and read back
 * in PLAINTEXT (see git history / AGENTS.md security audit). Also usable
 * for other sensitive user-supplied text (email API keys, Telegram bot
 * tokens).
 *
 * Algorithm: AES-256-GCM via Node's built-in `crypto` module — no new
 * dependency, authenticated encryption (tampering is detected on decrypt
 * via the GCM auth tag).
 *
 * Envelope format (stored verbatim in the existing `text` column, so no
 * schema/type migration is needed):
 *   v1:<base64 iv>:<base64 authTag>:<base64 ciphertext>
 *
 * Master key: WALLET_ENCRYPTION_KEY env var, a 32-byte key encoded as
 * base64. Loaded once at module scope; a missing/malformed key throws
 * immediately (fail closed — never silently fall back to storing
 * plaintext).
 *
 * This module is the single chokepoint for encrypt/decrypt. Swapping the
 * local-AES implementation for a real KMS (AWS KMS, GCP KMS, HashiCorp
 * Vault transit, etc.) later only requires changing the internals of
 * `encryptSecret`/`decryptSecret` — every call site stays the same.
 *
 * Backward-compat: `decryptSecret` treats any value WITHOUT the `v1:`
 * prefix as legacy plaintext and returns it unchanged. This lets
 * `scripts/reencrypt-agent-wallets.ts` migrate existing rows gradually,
 * and lets raw env-provided keys (e.g. ADMIN_PRIVATE_KEY, which is never
 * stored in the DB) pass through `getAgentAccount`/`decryptSecret`
 * unchanged when callers use it as a fallback value.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ENVELOPE_PREFIX = 'v1'
const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12 // recommended nonce size for GCM
const KEY_LENGTH = 32 // AES-256

let cachedKey: Buffer | null = null

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey

  const raw = process.env.WALLET_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      '[walletEncryption] WALLET_ENCRYPTION_KEY is not set. Generate one with ' +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"` ' +
        'and set it in your environment before starting the server.',
    )
  }

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `[walletEncryption] WALLET_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes ` +
        `(got ${key.length}). It must be a base64-encoded 32-byte key.`,
    )
  }

  cachedKey = key
  return cachedKey
}

/** True if `value` is already in our versioned envelope format. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${ENVELOPE_PREFIX}:`)
}

/**
 * Encrypts a plaintext secret (private key hex, API key, bot token, …)
 * into a versioned envelope safe to store in a `text` column.
 * Idempotent-safe to call defensively — throws if given an already-
 * encrypted value, since re-encrypting would double-wrap it.
 */
export function encryptSecret(plaintext: string): string {
  if (isEncrypted(plaintext)) {
    throw new Error('[walletEncryption] refusing to re-encrypt an already-encrypted value')
  }
  const key = getMasterKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    ENVELOPE_PREFIX,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':')
}

/**
 * Decrypts a value produced by `encryptSecret`. If `value` is not in the
 * versioned envelope format (legacy plaintext, or a raw env-provided
 * key), it's returned unchanged — see the module doc comment for why
 * this matters during migration.
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value

  const parts = value.split(':')
  if (parts.length !== 4) {
    throw new Error('[walletEncryption] malformed envelope (expected 4 colon-separated parts)')
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts
  const key = getMasterKey()
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')

  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

/**
 * Encrypts `plaintext` only if it isn't already an envelope — the write-
 * boundary guard used by upsert helpers so repeated writes of an
 * already-encrypted value (e.g. an unrelated field update) never
 * double-encrypt.
 */
export function encryptSecretIfNeeded(value: string): string {
  return isEncrypted(value) ? value : encryptSecret(value)
}
