/**
 * mint-agents.ts — ERC-8004 NFT mint for every skill in the registry.
 *
 * For each skill where `agent_token_id IS NULL`, this script:
 *   1. Builds an ERC-8004 metadata JSON (per draft EIP-8004 schema)
 *   2. Pins the metadata to IPFS via Pinata → gets `ipfs://<CID>` URI
 *   3. Calls `IdentityRegistry.register(uri)` on Arc Testnet from the admin wallet
 *   4. Waits for receipt, extracts tokenId from the `Transfer` / `Registered` event
 *   5. Persists `agent_token_id`, `agent_tx_hash`, `agent_minted_at` on the skills row
 *
 * Idempotent — re-running skips already-minted skills. If a step fails,
 * partial state is logged so we know exactly what to retry.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { decodeEventLog, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'

import { skills } from '../lib/db/schema'
import { pinJSON, pingPinata } from '../lib/chain/pinata'

// ─── Required env ─────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL missing')

const ARC_RPC = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC
if (!ARC_RPC) throw new Error('ARC_RPC_URL / NEXT_PUBLIC_ARC_RPC missing')

const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY
if (!ADMIN_PK) throw new Error('ADMIN_PRIVATE_KEY missing')

const REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS ??
  '0x8004A818BFB912233c491871b3d84c89A494BD9e') as `0x${string}`

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

// ─── viem setup ────────────────────────────────────────────────
const arcChain = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? '5042002'),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
})

const publicClient = createPublicClient({ chain: arcChain, transport: http(ARC_RPC) })
const adminAccount = privateKeyToAccount(ADMIN_PK as `0x${string}`)
const adminWallet = createWalletClient({ account: adminAccount, chain: arcChain, transport: http(ARC_RPC) })

const identityAbi = parseAbi([
  'function register(string agentURI) external returns (uint256 agentId)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
])

// ─── DB ────────────────────────────────────────────────────────
const sql = postgres(DATABASE_URL, { prepare: false })
const db = drizzle(sql, { schema: { skills } })

/** Retry a DB op up to N times. Catches Supabase's intermittent ENOTFOUND. */
async function retryDb<T>(fn: () => Promise<T>, label: string, attempts = 5): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const msg = e instanceof Error ? e.message : String(e)
      const isDns = /ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(msg)
      console.log(`  ⟳ DB ${label} attempt ${i + 1}/${attempts} failed (${isDns ? 'DNS' : 'other'}); retrying in ${(i + 1) * 2}s…`)
      await new Promise((r) => setTimeout(r, (i + 1) * 2000))
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

// ─── ERC-8004 metadata builder ────────────────────────────────
type Manifest = {
  display_name?: string
  description?: string
  category?: string
  best_for_keywords?: string[]
  cost_credits?: number
  owner_wallet?: string
  input_schema?: unknown
  provider_apis?: string[]
}

function buildMetadata(skillName: string, manifest: Manifest, endpoint: string) {
  // Endpoint URL: prefer the public API host, fall back to whatever
  // NEXT_PUBLIC_APP_URL is. If both unset, mark dev so evaluators know
  // not to trust this URL.
  const publicHost =
    process.env.PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'https://gigawork.example.com'
  const isDev = publicHost.includes('localhost') || publicHost.includes('127.0.0.1')
  const endpointURL = endpoint.startsWith('http')
    ? endpoint.replace(/^https?:\/\/[^/]+/, publicHost)
    : `${publicHost}/api/skills/${skillName}`

  return {
    // ERC-8004 registration document — per draft spec
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    schema_version: '1.0',

    // Required fields
    name: manifest.display_name ?? skillName,
    description: manifest.description ?? '',

    // ERC-8004 mandates this — list of trust mechanisms supported by the agent
    supportedTrust: ['reputation'],

    // Service routing — how clients reach the skill
    services: [
      {
        name: 'gigawork',
        type: 'http-rpc',
        endpoint: endpointURL,
        protocol: 'erc-8183',
      },
    ],

    active: true,

    // ─── Extensions (custom — not in spec but useful for our use case) ──
    agent_id: skillName,
    category: manifest.category ?? 'general',
    keywords: manifest.best_for_keywords ?? [],

    pricing: {
      cost_credits: manifest.cost_credits ?? 8,
      cost_usdc: ((manifest.cost_credits ?? 8) / 100).toFixed(2),
      currency: 'USDC',
    },

    // Owner that collects fees (ERC-8183 settlement target). Default
    // to admin so the manifest matches on-chain ownership (register()
    // mints to msg.sender = admin). The old `0x4c7758...` hardcode was
    // a dev artifact — see scripts/transfer-agents.ts header.
    owner: {
      wallet: manifest.owner_wallet ?? adminAccount.address.toLowerCase(),
      platform: 'GigaWork',
    },

    // Input contract — clients use this to know how to call the skill
    input_schema: manifest.input_schema ?? null,

    // External provider APIs the skill aggregates (transparency for evaluators)
    provider_apis: manifest.provider_apis ?? [],

    // Provenance
    minted_by: 'gigawork-v2',
    minted_at: new Date().toISOString(),
    is_dev_endpoint: isDev,
  }
}

// ─── Mint one skill ────────────────────────────────────────────
async function mintOne(skill: { id: string; name: string; manifest: Manifest; endpoint: string }) {
  console.log(`\n──── ${skill.name} ────`)

  // Build metadata
  const metadata = buildMetadata(skill.name, skill.manifest, skill.endpoint)

  // Pin to IPFS
  console.log('  📌 Pinning metadata to IPFS…')
  const pin = await pinJSON(metadata, { name: `gigawork-skill-${skill.name}` })
  console.log(`     CID: ${pin.cid}`)
  console.log(`     Gateway: ${pin.gatewayUrl}`)

  // Register on-chain
  console.log('  ⛓  Calling IdentityRegistry.register()…')
  const txHash = await adminWallet.writeContract({
    address: REGISTRY,
    abi: identityAbi,
    functionName: 'register',
    args: [pin.ipfsUri],
  })
  console.log(`     Tx: ${txHash}`)
  console.log(`     Explorer: ${EXPLORER}/tx/${txHash}`)

  // Wait for receipt + extract tokenId
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    throw new Error(`Tx reverted: ${txHash}`)
  }

  let tokenId: string | null = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: identityAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'Registered') {
        tokenId = decoded.args.agentId.toString()
        break
      }
      if (decoded.eventName === 'Transfer' && !tokenId) {
        tokenId = decoded.args.tokenId.toString()
      }
    } catch {
      /* skip non-matching log */
    }
  }
  if (!tokenId) throw new Error('register succeeded but no Registered/Transfer event in receipt')

  console.log(`  ✓ Token #${tokenId}`)

  // Persist + bump manifest with mint provenance for visibility
  const newManifest = {
    ...skill.manifest,
    on_chain: {
      token_id: tokenId,
      tx_hash: txHash,
      contract: REGISTRY,
      ipfs_uri: pin.ipfsUri,
      ipfs_gateway: pin.gatewayUrl,
      minted_at: new Date().toISOString(),
      explorer_url: `${EXPLORER}/tx/${txHash}`,
    },
  }
  await retryDb(
    () =>
      db
        .update(skills)
        .set({
          agentTokenId: tokenId,
          agentTxHash: txHash,
          agentMintedAt: new Date(),
          manifest: newManifest,
        })
        .where(eq(skills.id, skill.id)),
    `persist ${skill.name}`,
  )

  return { tokenId, txHash, ipfsUri: pin.ipfsUri }
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const reset = process.argv.slice(2).includes('--reset')

  console.log('GigaWork ERC-8004 Agent Mint')
  console.log(`Registry: ${REGISTRY}`)
  console.log(`Admin:    ${adminAccount.address}`)
  console.log(`RPC:      ${ARC_RPC}`)
  console.log(`Pinata:   ${(await pingPinata()) ? 'OK' : '!! AUTH FAILED'}`)
  if (reset) console.log('Mode:     --reset (re-mint all skills, orphan old tokens)')
  console.log()

  // Native balance check — register costs gas
  const bal = await publicClient.getBalance({ address: adminAccount.address })
  console.log(`Admin balance: ${Number(bal) / 1e18} ETH`)
  if (bal < BigInt(1e15)) {
    throw new Error('Admin wallet has insufficient gas (< 0.001 ETH). Top up before minting.')
  }

  // If --reset: clear agent_token_id on all skills so the loop treats
  // them as fresh. Old tokens stay on-chain (orphan, harmless on testnet).
  if (reset) {
    const cleared = await retryDb(
      async () => {
        const r = await sql`UPDATE skills
          SET agent_token_id = NULL, agent_tx_hash = NULL, agent_minted_at = NULL
          WHERE agent_token_id IS NOT NULL
          RETURNING name`
        return r as unknown as Array<{ name: string }>
      },
      'reset minted state',
    )
    console.log(`Cleared mint state on ${cleared.length} skills (old tokens orphaned on chain)\n`)
  }

  // Retry the initial DB select — Supabase pooler DNS resolves intermittently
  // from some ISPs, so a single ENOTFOUND shouldn't kill the whole batch.
  const rows = await retryDb(() => db.select().from(skills), 'load skills')
  const unminted = rows.filter((r) => !r.agentTokenId)

  console.log(`\nSkills total:    ${rows.length}`)
  console.log(`Already minted:  ${rows.length - unminted.length}`)
  console.log(`To mint now:     ${unminted.length}`)

  if (unminted.length === 0) {
    console.log('\n✅ All skills already minted. Done.')
    await sql.end()
    return
  }

  let success = 0
  let failed = 0
  const results: Array<{ name: string; tokenId: string; txHash: string; ipfsUri: string }> = []
  const errors: Array<{ name: string; error: string }> = []

  for (const row of unminted) {
    try {
      const r = await mintOne({
        id: row.id,
        name: row.name,
        manifest: (row.manifest ?? {}) as Manifest,
        endpoint: row.endpoint,
      })
      results.push({ name: row.name, ...r })
      success++
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      console.log(`  ✗ FAILED: ${msg}`)
      errors.push({ name: row.name, error: msg })
      failed++
    }
  }

  console.log('\n═══ SUMMARY ═══')
  console.log(`✓ Success: ${success}/${unminted.length}`)
  if (failed > 0) console.log(`✗ Failed:  ${failed}`)

  if (results.length > 0) {
    console.log('\n┌──────────────────────────┬──────────┬──────────────────────────────────────┐')
    console.log('│ Skill                    │ Token ID │ Tx                                   │')
    console.log('├──────────────────────────┼──────────┼──────────────────────────────────────┤')
    for (const r of results) {
      const name = r.name.padEnd(24).slice(0, 24)
      const tid = r.tokenId.padEnd(8)
      const tx = r.txHash.slice(0, 10) + '…' + r.txHash.slice(-6)
      console.log(`│ ${name} │ ${tid} │ ${tx}                  │`)
    }
    console.log('└──────────────────────────┴──────────┴──────────────────────────────────────┘')
  }

  if (errors.length > 0) {
    console.log('\nErrors:')
    for (const e of errors) console.log(`  - ${e.name}: ${e.error}`)
  }

  await sql.end()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
