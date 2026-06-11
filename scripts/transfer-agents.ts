/**
 * transfer-agents.ts — chuyển toàn bộ ERC-8004 agent NFT từ admin wallet
 * sang owner wallet (0x4c77584f57d385e0f2996bd4ff178c93dff034c0).
 *
 * - Đọc tất cả skills đã mint (agent_token_id IS NOT NULL) từ DB
 * - Kiểm tra ownerOf(tokenId) on-chain
 *   • nếu = admin       → gọi transferFrom(admin, owner, tokenId)
 *   • nếu = owner đích  → bỏ qua (đã chuyển rồi)
 *   • nếu khác          → cảnh báo và bỏ qua
 * - Cập nhật manifest.on_chain.owner sau khi transfer thành công
 *
 * Idempotent — chạy lại không gây hại. Cần ADMIN_PRIVATE_KEY ký được tx.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'

import { skills } from '../lib/db/schema'

// ─── Required env ──────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL missing')

const ARC_RPC = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC
if (!ARC_RPC) throw new Error('ARC_RPC_URL missing')

const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY
if (!ADMIN_PK) throw new Error('ADMIN_PRIVATE_KEY missing')

const REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS ??
  '0x8004A818BFB912233c491871b3d84c89A494BD9e') as `0x${string}`

// DEPRECATED: do NOT run this script. It transfers skill agent NFTs away
// from admin, breaking the ValidationRegistry / ReputationRegistry
// background-attest flow (which requires admin to own the agent NFT to
// call validationRequest without a popup). If you absolutely must move
// them, set AGENT_OWNER_WALLET explicitly — no default hardcoded.
const TARGET_OWNER = process.env.AGENT_OWNER_WALLET?.toLowerCase() as
  | `0x${string}`
  | undefined
if (!TARGET_OWNER) {
  throw new Error(
    'transfer-agents.ts is deprecated. To force-run, set AGENT_OWNER_WALLET env explicitly.',
  )
}

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

const erc721Abi = parseAbi([
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function transferFrom(address from, address to, uint256 tokenId) external',
  'function safeTransferFrom(address from, address to, uint256 tokenId) external',
])

// ─── DB ────────────────────────────────────────────────────────
const sql = postgres(DATABASE_URL, { prepare: false })
const db = drizzle(sql, { schema: { skills } })

async function retry<T>(fn: () => Promise<T>, label: string, attempts = 5): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (e) {
      last = e
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`  ⟳ ${label} attempt ${i + 1}/${attempts} failed (${msg.slice(0, 80)}); retrying…`)
      await new Promise((r) => setTimeout(r, (i + 1) * 2000))
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

async function main() {
  console.log('─── ERC-8004 ownership transfer ─────────────────────')
  console.log(`Registry  : ${REGISTRY}`)
  console.log(`Admin (from): ${adminAccount.address}`)
  console.log(`Owner (to)  : ${TARGET_OWNER}`)
  console.log()

  if (adminAccount.address.toLowerCase() === TARGET_OWNER) {
    console.log('Admin wallet đã là target owner — không cần transfer.')
    process.exit(0)
  }

  const rows = await retry(() =>
    sql<Array<{ id: string; name: string; agent_token_id: string; manifest: Record<string, unknown> }>>`
      SELECT id, name, agent_token_id, manifest
      FROM skills
      WHERE agent_token_id IS NOT NULL
      ORDER BY agent_token_id::int
    `,
  'load minted skills')

  console.log(`Tìm thấy ${rows.length} agent đã mint.\n`)

  let transferred = 0, alreadyOwned = 0, skipped = 0

  for (const r of rows) {
    const tokenId = BigInt(r.agent_token_id)
    const tag = `#${r.agent_token_id.padStart(4)} ${r.name.padEnd(20)}`

    let owner: string
    try {
      owner = (await publicClient.readContract({
        address: REGISTRY, abi: erc721Abi, functionName: 'ownerOf', args: [tokenId],
      })) as string
    } catch (e) {
      console.log(`  ✗ ${tag}  ownerOf failed: ${(e as Error).message?.slice(0, 80)}`)
      skipped++
      continue
    }

    const ownerLower = owner.toLowerCase()
    if (ownerLower === TARGET_OWNER) {
      console.log(`  = ${tag}  đã thuộc owner đích`)
      alreadyOwned++
      continue
    }
    if (ownerLower !== adminAccount.address.toLowerCase()) {
      console.log(`  ! ${tag}  owner hiện tại = ${owner} (không phải admin) — bỏ qua`)
      skipped++
      continue
    }

    try {
      const hash = await adminWallet.writeContract({
        address: REGISTRY,
        abi: erc721Abi,
        functionName: 'transferFrom',
        args: [adminAccount.address, TARGET_OWNER!, tokenId],
      })
      console.log(`  → ${tag}  tx=${hash} … chờ receipt`)
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
      if (receipt.status !== 'success') {
        console.log(`  ✗ ${tag}  tx reverted`)
        skipped++
        continue
      }
      console.log(`  ✓ ${tag}  ${EXPLORER}/tx/${hash}`)

      // Cập nhật manifest.on_chain.owner trong DB
      const newManifest = {
        ...(r.manifest ?? {}),
        on_chain: {
          ...((r.manifest as { on_chain?: Record<string, unknown> })?.on_chain ?? {}),
          owner: TARGET_OWNER,
          owner_transferred_at: new Date().toISOString(),
          owner_transfer_tx: hash,
        },
      }
      await retry(() => db.update(skills).set({ manifest: newManifest as unknown }).where(eq(skills.id, r.id)),
        `update manifest ${r.name}`)

      transferred++
    } catch (e) {
      console.log(`  ✗ ${tag}  transfer failed: ${(e as Error).message?.slice(0, 120)}`)
      skipped++
    }
  }

  console.log(`\n─── Kết quả ─────────────────────────────────────────`)
  console.log(`  Đã transfer    : ${transferred}`)
  console.log(`  Đã thuộc owner : ${alreadyOwned}`)
  console.log(`  Bỏ qua / lỗi   : ${skipped}`)
  console.log(`  Tổng           : ${rows.length}`)
  await sql.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
