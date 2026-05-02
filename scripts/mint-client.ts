/**
 * mint-client.ts — mint một ERC-8004 NFT kiểu "client" cho admin wallet
 * để dùng khi test workflow (admin = người thuê, các agent providers = người làm).
 *
 * Schema ERC-8004 không phân biệt provider/client ở cấp contract — tất cả đều
 * là tokenId trong IdentityRegistry. Sự khác biệt nằm ở metadata.type.
 *
 *   - provider/agent  →  có services[], có pricing, được dispatch
 *   - client          →  không services, chỉ là danh tính người gọi
 *
 * Sau khi mint, ghi tokenId vào bảng `client_agents` để app biết admin đã
 * có client identity (tránh mint trùng).
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { decodeEventLog, parseAbi, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import postgres from 'postgres'

import { pinJSON, pingPinata } from '../lib/chain/pinata'

// ─── Env ───────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL!
const ARC_RPC = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC!
const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY!
const REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS ??
  '0x8004A818BFB912233c491871b3d84c89A494BD9e') as `0x${string}`
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

// ─── viem ──────────────────────────────────────────────────────
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

const sql = postgres(DATABASE_URL, { prepare: false })

// ─── Build metadata cho client identity ───────────────────────
function buildClientMetadata(name: string, ownerAddr: string) {
  const isDev = APP_URL.includes('localhost') || APP_URL.includes('127.0.0.1')
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    schema_version: '1.0',
    role: 'client',
    name,
    description:
      'GigaWork test client identity — admin wallet sử dụng để dispatch jobs ' +
      'tới các provider agents (testnet workflow validation).',
    supportedTrust: ['reputation'],
    services: [],
    active: true,
    agent_id: `client-${ownerAddr.slice(2, 10).toLowerCase()}`,
    category: 'client',
    keywords: ['gigawork', 'client', 'tester', 'admin'],
    owner: { wallet: ownerAddr.toLowerCase(), platform: 'GigaWork' },
    minted_by: 'gigawork-v2',
    minted_at: new Date().toISOString(),
    is_dev_endpoint: isDev,
  }
}

async function ensureClientTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS client_agents (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet          text UNIQUE NOT NULL,
      token_id        text NOT NULL,
      tx_hash         text NOT NULL,
      ipfs_uri        text NOT NULL,
      metadata        jsonb NOT NULL,
      minted_at       timestamptz NOT NULL DEFAULT now()
    )
  `
}

async function main() {
  console.log('─── Mint ERC-8004 client identity ────────────────────')
  console.log(`Registry  : ${REGISTRY}`)
  console.log(`Owner     : ${adminAccount.address} (admin)`)
  console.log()

  // Ping Pinata trước để fail-fast
  if (!(await pingPinata())) throw new Error('Pinata auth failed — check PINATA_JWT')

  await ensureClientTable()

  // Đã mint chưa?
  const [existing] = await sql<Array<{ token_id: string; tx_hash: string; ipfs_uri: string }>>`
    SELECT token_id, tx_hash, ipfs_uri FROM client_agents
    WHERE wallet = ${adminAccount.address.toLowerCase()}
    LIMIT 1
  `
  const force = process.argv.includes('--force')
  if (existing && !force) {
    console.log(`✓ Admin đã có client NFT — tokenId=#${existing.token_id}`)
    console.log(`  tx     : ${EXPLORER}/tx/${existing.tx_hash}`)
    console.log(`  ipfs   : ${existing.ipfs_uri}`)
    console.log(`  (chạy với --force để mint thêm cái mới)`)
    await sql.end()
    return
  }

  // 1) Pin metadata
  const meta = buildClientMetadata('GigaWork Admin (Client)', adminAccount.address)
  console.log('① Pin metadata to IPFS via Pinata…')
  const pin = await pinJSON(meta, { name: `client-${adminAccount.address.slice(2, 10).toLowerCase()}` })
  console.log(`   cid=${pin.cid}`)
  console.log(`   uri=${pin.ipfsUri}`)

  // 2) register() on-chain
  console.log('② IdentityRegistry.register()…')
  const hash = await adminWallet.writeContract({
    address: REGISTRY,
    abi: identityAbi,
    functionName: 'register',
    args: [pin.ipfsUri],
  })
  console.log(`   tx=${hash} … chờ receipt`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
  if (receipt.status !== 'success') throw new Error('register() reverted')

  // 3) Trích tokenId từ Transfer/Registered event
  let tokenId: bigint | null = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) continue
    try {
      const parsed = decodeEventLog({ abi: identityAbi, data: log.data, topics: log.topics })
      if (parsed.eventName === 'Registered' || parsed.eventName === 'Transfer') {
        tokenId = (parsed.args as any).agentId ?? (parsed.args as any).tokenId ?? null
        if (tokenId !== null) break
      }
    } catch { /* skip non-matching logs */ }
  }
  if (tokenId === null) throw new Error('không tìm được tokenId trong receipt logs')
  console.log(`   ✓ tokenId=#${tokenId.toString()}`)

  // 4) Persist
  await sql`
    INSERT INTO client_agents (wallet, token_id, tx_hash, ipfs_uri, metadata)
    VALUES (
      ${adminAccount.address.toLowerCase()},
      ${tokenId.toString()},
      ${hash},
      ${pin.ipfsUri},
      ${sql.json(meta)}
    )
    ON CONFLICT (wallet) DO UPDATE SET
      token_id = EXCLUDED.token_id,
      tx_hash = EXCLUDED.tx_hash,
      ipfs_uri = EXCLUDED.ipfs_uri,
      metadata = EXCLUDED.metadata,
      minted_at = now()
  `

  console.log()
  console.log('─── Done ────────────────────────────────────────────')
  console.log(`  tokenId : #${tokenId.toString()}`)
  console.log(`  owner   : ${adminAccount.address}`)
  console.log(`  ipfs    : ${pin.gatewayUrl}`)
  console.log(`  tx      : ${EXPLORER}/tx/${hash}`)
  await sql.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
