/**
 * pinata — IPFS pinning via Pinata's pinJSONToIPFS API.
 *
 * Uses curl subprocess with DoH-resolved IP to bypass VN ISP DNS block on
 * `api.pinata.cloud` (same workaround as Polymarket and Kimi). Returns a
 * `{cid, gatewayUrl, ipfsUri}` triple.
 *
 * Used by the ERC-8004 agent mint script — every skill's metadata JSON is
 * pinned here and the resulting `ipfs://CID` URI stamped on-chain via
 * IdentityRegistry.register().
 */
import { curlFetchJSON } from '@/lib/skills/curlFetch'

const PINATA_API = 'https://api.pinata.cloud'

export interface PinResult {
  cid: string
  ipfsUri: string
  gatewayUrl: string
  size: number
  pinnedAt: string
}

/**
 * Pin a JSON object to IPFS via Pinata. Throws on failure (no fallback —
 * mint should abort if metadata can't be pinned).
 */
export async function pinJSON(payload: unknown, opts: { name?: string } = {}): Promise<PinResult> {
  const jwt = process.env.PINATA_JWT
  if (!jwt) throw new Error('PINATA_JWT not configured — cannot pin metadata to IPFS')

  const gatewayBase = process.env.PINATA_GATEWAY ?? 'https://gateway.pinata.cloud/ipfs/'

  type PinResp = { IpfsHash: string; PinSize: number; Timestamp: string }
  const res = await curlFetchJSON<PinResp>(`${PINATA_API}/pinning/pinJSONToIPFS`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      pinataContent: payload,
      pinataMetadata: { name: opts.name ?? 'gigawork-agent-metadata' },
    }),
    timeoutMs: 30_000,
  })

  return {
    cid: res.IpfsHash,
    ipfsUri: `ipfs://${res.IpfsHash}`,
    gatewayUrl: `${gatewayBase.replace(/\/$/, '/')}${res.IpfsHash}`,
    size: res.PinSize,
    pinnedAt: res.Timestamp,
  }
}

/** Sanity check Pinata auth — useful before kicking off a batch mint. */
export async function pingPinata(): Promise<boolean> {
  try {
    await curlFetchJSON(`${PINATA_API}/data/testAuthentication`, {
      method: 'GET',
      headers: { authorization: `Bearer ${process.env.PINATA_JWT}` },
      timeoutMs: 8_000,
    })
    return true
  } catch {
    return false
  }
}
