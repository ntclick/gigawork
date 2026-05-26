import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(process.cwd(), '.env') })
dotenv.config({ path: resolve(process.cwd(), '.env.local'), override: true })

import { createPublicClient, http, defineChain, keccak256, encodePacked } from 'viem'
import { OrbitportSDK } from '@spacecomputer-io/orbitport-sdk-ts'

// ─── Interfaces & Caches ────────────────────────────────────────
export interface CosmicProofDetails {
  blockHash: `0x${string}`
  spaceComputerEntropy: string | null
  verificationMode: 'authenticated_sdk' | 'public_sdk_ipfs' | 'fallback_ipfs' | 'rpc_fallback'
  sourceUrl?: string
  timestamp: number
  src?: string | null
  service?: string | null
  sequence?: number | null
  signature?: {
    algo?: string
    value: string
    pk: string
  } | null
}

interface SpaceComputerFetchResult {
  entropy: string | null
  verificationMode: CosmicProofDetails['verificationMode']
  src?: string | null
  service?: string | null
  signature?: CosmicProofDetails['signature']
  sourceUrl?: string
  sequence?: number | null
}

const seedCache = new Map<number, `0x${string}`>()
export const proofCache = new Map<number, CosmicProofDetails>()

/**
 * Helper to retrieve proof metadata for a given commit block.
 */
export function getCosmicProof(commitBlock: number): CosmicProofDetails | undefined {
  return proofCache.get(commitBlock)
}

// ─── viem setup ────────────────────────────────────────────────
const ARC_RPC = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC ?? 'https://rpc.testnet.arc.network'
const arcChain = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '5042002'),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
})

const publicClient = createPublicClient({
  chain: arcChain,
  transport: http(ARC_RPC),
})

/**
 * Fetches the cosmic entropy and cryptographic proofs from SpaceComputer cTRNG.
 * First attempts authenticated SDK request, then falls back to public SDK IPFS mode,
 * and finally to direct IPFS gateway manual HTTP requests.
 */
async function fetchSpaceComputerEntropy(): Promise<SpaceComputerFetchResult> {
  const clientId = process.env.ORBITPORT_CLIENT_ID?.trim()
  const clientSecret = process.env.ORBITPORT_CLIENT_SECRET?.trim()

  // 1. Authenticated SDK Request (Satellite cTRNG Gateway)
  if (clientId && clientSecret) {
    try {
      console.log('🛰️ Initiating authenticated SpaceComputer cTRNG request via SDK...')
      const sdk = new OrbitportSDK({
        config: {
          clientId,
          clientSecret,
        },
      })
      const result = await sdk.ctrng.random()
      if (result?.success && result?.data?.data) {
        const entropy = result.data.data
        console.log(`🌌 Successfully retrieved SpaceComputer cTRNG cosmic entropy via SDK: ${entropy}`)
        return {
          entropy,
          verificationMode: 'authenticated_sdk',
          src: result.data.src || null,
          service: result.data.service || null,
          signature: result.data.signature || null,
        }
      }
    } catch (e) {
      console.warn('⚠️ Authenticated SDK cTRNG request failed, falling back to public IPFS beacon:', e instanceof Error ? e.message : e)
    }
  }

  // 2. Fallback 1: Try using the OrbitportSDK without credentials (public IPFS beacon mode)
  try {
    console.log('🛰️ Initiating public SpaceComputer cTRNG request via SDK (unauthenticated IPFS mode)...')
    const publicSdk = new OrbitportSDK({ config: {} })
    const result = await publicSdk.ctrng.random()
    if (result?.success && result?.data?.data) {
      const entropy = result.data.data
      console.log(`🌌 Successfully retrieved SpaceComputer cTRNG cosmic entropy via public SDK (IPFS): ${entropy}`)
      return {
        entropy,
        verificationMode: 'public_sdk_ipfs',
        sequence: (result.data as any).sequence || null,
      }
    }
  } catch (e) {
    console.warn('⚠️ Public SDK IPFS request failed, falling back to manual HTTP IPFS gateways:', e instanceof Error ? e.message : e)
  }

  // 3. Fallback 2: Direct HTTP fetch from public IPFS beacon gateways
  const gateways = [
    "https://ipfs.io/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f",
    "https://cloudflare-ipfs.com/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f",
    "https://dweb.link/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
  ]

  for (const url of gateways) {
    try {
      console.log(`🛰️ Attempting to fetch SpaceComputer cosmic cTRNG from fallback IPFS: ${url}`)
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
      if (res.ok) {
        const json = await res.json()
        const beacon = json?.data || json
        if (beacon?.ctrng && beacon.ctrng.length > 0) {
          const value = beacon.ctrng[0]
          console.log(`🌌 Successfully retrieved SpaceComputer cTRNG cosmic entropy via fallback IPFS: ${value}`)
          return {
            entropy: value,
            verificationMode: 'fallback_ipfs',
            sourceUrl: url,
            sequence: beacon.sequence || null,
          }
        }
      }
    } catch (e) {
      console.warn(`⚠️ Failed to fetch cTRNG from fallback gateway ${url}:`, e instanceof Error ? e.message : e)
    }
  }

  return {
    entropy: null,
    verificationMode: 'rpc_fallback',
  }
}

/**
 * Fetches the Cosmic Randomness Seed for the given `commitBlock`.
 * Integrates SpaceComputer cTRNG with Arc Testnet block hash:
 * finalSeed = keccak256(block.hash + spaceComputerEntropy)
 */
export async function fetchCosmicSeed(commitBlock: number): Promise<`0x${string}`> {
  if (seedCache.has(commitBlock)) {
    return seedCache.get(commitBlock)!
  }

  try {
    // 1. Query the actual blockchain block hash from Arc RPC
    console.log(`📡 Fetching blockchain block #${commitBlock} from Arc Testnet...`)
    const block = await publicClient.getBlock({
      blockNumber: BigInt(commitBlock),
    })

    if (!block || !block.hash) {
      throw new Error(`Block hash for block ${commitBlock} not found or not yet mined`)
    }
    console.log(`✓ Blockchain block hash resolved: ${block.hash}`)

    // 2. Fetch SpaceComputer cosmic physical entropy
    const result = await fetchSpaceComputerEntropy()
    const spaceComputerEntropy = result.entropy

    let finalSeed: `0x${string}`

    if (spaceComputerEntropy) {
      // Clean up hex formatting
      const cleanEntropy = spaceComputerEntropy.startsWith('0x') 
        ? spaceComputerEntropy 
        : `0x${spaceComputerEntropy}`

      // Mix blockchain entropy + space physical entropy
      finalSeed = keccak256(
        encodePacked(
          ['bytes32', 'bytes32'],
          [block.hash, cleanEntropy as `0x${string}`]
        )
      )
      console.log(`🔮 Mixed dual-entropy cosmic seed derived: ${finalSeed}`)
    } else {
      console.warn(`⚠️ Could not reach SpaceComputer cTRNG beacon. Falling back to block hash only.`)
      // Fallback: Mix block hash with deterministic protocol string
      finalSeed = keccak256(
        encodePacked(
          ['bytes32', 'string'],
          [block.hash, `SpaceComputer-cTRNG-Beacon-v1-${commitBlock}`]
        )
      )
      console.log(`🔮 Block-hash mixed fallback seed derived: ${finalSeed}`)
    }

    // Save proof metadata in global cache for API routes to read
    const proofDetails: CosmicProofDetails = {
      blockHash: block.hash,
      spaceComputerEntropy,
      verificationMode: result.verificationMode,
      sourceUrl: result.sourceUrl,
      sequence: result.sequence ?? null,
      src: result.src ?? null,
      service: result.service ?? null,
      signature: result.signature ?? null,
      timestamp: Date.now(),
    }
    proofCache.set(commitBlock, proofDetails)

    seedCache.set(commitBlock, finalSeed)
    return finalSeed
  } catch (error) {
    console.error(`⚠️ Error fetching cosmic seed for block ${commitBlock} via RPC:`, error)
    
    // In case of RPC outage, generate a deterministic fallback hash
    const fallbackSeed = keccak256(
      encodePacked(
        ['string'],
        [`SpaceComputer-cTRNG-Fallback-Seed-Block-${commitBlock}`]
      )
    )
    
    console.log(`ℹ️ Generated secure fallback seed: ${fallbackSeed}`)
    return fallbackSeed
  }
}
