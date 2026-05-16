/**
 * Client-side identity cache, keyed by wallet address.
 *
 * Strategy: once we've confirmed (via /api/me) that a given wallet owns an
 * Identity NFT, persist that fact in localStorage. Subsequent page loads on
 * the SAME wallet render the verified badge instantly with no /api/me probe
 * and no server-side ownerOf RPC roundtrip — the bottleneck for cold loads.
 *
 * Invalidation rules:
 *  - Active wallet address changes  → read the new wallet's cache entry
 *    (cold if absent). Other entries remain — flipping back to the prior
 *    wallet stays instant.
 *  - User mints                     → write the fresh entry.
 *  - User logs out                  → clear ALL entries so the next user
 *    on this device doesn't see stale state.
 *  - Server reports `hasIdentity: false` after a /api/me probe for a
 *    wallet that has a cached `true` (eg NFT transferred away) → cache
 *    is overwritten with the new server truth.
 *
 * We never trust cache for write paths — /api/identity/confirm always
 * re-verifies ownerOf on chain before flipping the DB row.
 */

const PREFIX = 'gw:identity:'
const ME_PREFIX = 'gw:me:'
const USDC_PREFIX = 'gw:usdc:'

export type CachedIdentity = {
  hasIdentity: boolean
  tokenId: string | null
  txHash: string | null
  mintedAt: string | null
  /** Wall-clock ms when the entry was written. Pure metadata — we don't
   *  enforce a TTL; only wallet change / logout / mint invalidate. */
  cachedAt: number
}

function keyFor(wallet: string): string {
  return `${PREFIX}${wallet.toLowerCase()}`
}

function meKey(wallet: string): string {
  return `${ME_PREFIX}${wallet.toLowerCase()}`
}

function usdcKey(wallet: string): string {
  return `${USDC_PREFIX}${wallet.toLowerCase()}`
}

export type CachedMe = {
  id: string
  wallet: string
  credits: number
  identity?: { hasIdentity: boolean; tokenId: string | null; txHash: string | null } | null
  cachedAt: number
}

export type CachedUSDC = {
  /** Raw bigint as decimal string — JSON can't carry bigints. */
  raw: string
  cachedAt: number
}

export function readMeCache(wallet: string | null | undefined): CachedMe | null {
  if (!wallet || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(meKey(wallet))
    if (!raw) return null
    return JSON.parse(raw) as CachedMe
  } catch {
    return null
  }
}

export function writeMeCache(wallet: string, value: Omit<CachedMe, 'cachedAt'>): void {
  if (typeof window === 'undefined') return
  try {
    const entry: CachedMe = { ...value, cachedAt: Date.now() }
    window.localStorage.setItem(meKey(wallet), JSON.stringify(entry))
  } catch {
    /* ignore */
  }
}

export function readUSDCCache(wallet: string | null | undefined): CachedUSDC | null {
  if (!wallet || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(usdcKey(wallet))
    if (!raw) return null
    return JSON.parse(raw) as CachedUSDC
  } catch {
    return null
  }
}

export function writeUSDCCache(wallet: string, raw: bigint): void {
  if (typeof window === 'undefined') return
  try {
    const entry: CachedUSDC = { raw: raw.toString(), cachedAt: Date.now() }
    window.localStorage.setItem(usdcKey(wallet), JSON.stringify(entry))
  } catch {
    /* ignore */
  }
}

export function readIdentityCache(wallet: string | null | undefined): CachedIdentity | null {
  if (!wallet || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(keyFor(wallet))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedIdentity
    if (typeof parsed.hasIdentity !== 'boolean') return null
    return parsed
  } catch {
    return null
  }
}

export function writeIdentityCache(
  wallet: string,
  value: Omit<CachedIdentity, 'cachedAt'>,
): void {
  if (typeof window === 'undefined') return
  try {
    const entry: CachedIdentity = { ...value, cachedAt: Date.now() }
    window.localStorage.setItem(keyFor(wallet), JSON.stringify(entry))
  } catch {
    /* quota or disabled storage — ignore */
  }
}

export function clearIdentityCache(wallet?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (wallet) {
      window.localStorage.removeItem(keyFor(wallet))
      window.localStorage.removeItem(meKey(wallet))
      window.localStorage.removeItem(usdcKey(wallet))
      return
    }
    const toRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (
        k &&
        (k.startsWith(PREFIX) || k.startsWith(ME_PREFIX) || k.startsWith(USDC_PREFIX))
      ) {
        toRemove.push(k)
      }
    }
    for (const k of toRemove) window.localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}
