/**
 * transfer-agents-to-admin.ts — Đảo ngược chuyển skill agent NFTs về admin.
 *
 * Vì sao: ERC-8004 ValidationRegistry's `validationRequest` là ownership-
 * gated (chỉ owner của agentId mới gọi được). Nếu skill agent NFTs thuộc
 * user, validation phải user-signed → cần UI popup. Khi admin sở hữu,
 * cả request và response đều fire server-side trong background.
 *
 * Script này:
 *   - Đọc tất cả skills (agent_token_id IS NOT NULL) từ DB
 *   - Lấy on-chain owner(tokenId)
 *   - Nếu owner ≠ admin → gọi `safeTransferFrom(currentOwner, admin, tokenId)`
 *     từ admin? Không được — admin không có quyền move NFT khỏi user wallet.
 *
 *   → Vì vậy script CHỈ chạy được khi current owner là 1 wallet mà admin
 *     control private key cho. Trong môi trường dev hiện tại admin sở hữu
 *     cả 2 keys, nhưng production user holds their own key → script này
 *     chỉ phục vụ dev cleanup.
 *
 *   - Nếu admin có private key của owner hiện tại (env CURRENT_OWNER_PK)
 *     → ký safeTransferFrom từ wallet đó về admin.
 *
 * Idempotent: skip nếu đã thuộc admin. Cần ADMIN_PRIVATE_KEY +
 * CURRENT_OWNER_PRIVATE_KEY (current owner của NFTs cần transfer).
 *
 * Usage:
 *   CURRENT_OWNER_PRIVATE_KEY=0x... npx tsx scripts/transfer-agents-to-admin.ts
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { parseAbi, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL missing')

const ARC_RPC = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC
if (!ARC_RPC) throw new Error('ARC_RPC_URL missing')

const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY
if (!ADMIN_PK) throw new Error('ADMIN_PRIVATE_KEY missing')

const CURRENT_OWNER_PK = process.env.CURRENT_OWNER_PRIVATE_KEY
if (!CURRENT_OWNER_PK) {
  throw new Error(
    'CURRENT_OWNER_PRIVATE_KEY missing — needed to sign safeTransferFrom from the wallet currently holding the NFTs',
  )
}

const REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS ??
  '0x8004A818BFB912233c491871b3d84c89A494BD9e') as `0x${string}`

const arcChain = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? '5042002'),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
})

const adminAccount = privateKeyToAccount(ADMIN_PK as `0x${string}`)
const currentOwnerAccount = privateKeyToAccount(CURRENT_OWNER_PK as `0x${string}`)
const publicClient = createPublicClient({ chain: arcChain, transport: http(ARC_RPC) })
const ownerWallet = createWalletClient({
  account: currentOwnerAccount,
  chain: arcChain,
  transport: http(ARC_RPC),
})

const abi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
])

const sql = postgres(DATABASE_URL, { prepare: false })

async function main() {
  console.log(`Admin:           ${adminAccount.address}`)
  console.log(`Current owner:   ${currentOwnerAccount.address}`)
  console.log(`Target (admin):  ${adminAccount.address}`)

  const rows = await sql<Array<{ id: string; name: string; agent_token_id: string }>>`
    SELECT id, name, agent_token_id FROM skills
    WHERE agent_token_id IS NOT NULL
    ORDER BY agent_token_id::int
  `
  console.log(`\nFound ${rows.length} skills with agent_token_id.`)

  let transferred = 0
  let alreadyAdmin = 0
  let skipped = 0

  for (const r of rows) {
    const tokenId = BigInt(r.agent_token_id)
    let owner: `0x${string}`
    try {
      owner = (await publicClient.readContract({
        address: REGISTRY,
        abi,
        functionName: 'ownerOf',
        args: [tokenId],
      })) as `0x${string}`
    } catch (err) {
      console.warn(
        `  [skip] #${r.agent_token_id} ${r.name}: ownerOf failed`,
        err instanceof Error ? err.message : err,
      )
      skipped++
      continue
    }

    const ownerLower = owner.toLowerCase()
    const adminLower = adminAccount.address.toLowerCase()
    const currentLower = currentOwnerAccount.address.toLowerCase()

    if (ownerLower === adminLower) {
      console.log(`  [ok] #${r.agent_token_id} ${r.name} — already admin-owned`)
      alreadyAdmin++
      continue
    }
    if (ownerLower !== currentLower) {
      console.warn(
        `  [skip] #${r.agent_token_id} ${r.name}: owned by ${owner}, not by CURRENT_OWNER_PRIVATE_KEY`,
      )
      skipped++
      continue
    }

    try {
      const txHash = await ownerWallet.writeContract({
        address: REGISTRY,
        abi,
        functionName: 'safeTransferFrom',
        args: [currentOwnerAccount.address, adminAccount.address, tokenId],
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      if (receipt.status === 'success') {
        console.log(`  [moved] #${r.agent_token_id} ${r.name} → admin ${txHash}`)
        transferred++
      } else {
        console.warn(`  [revert] #${r.agent_token_id} ${r.name} tx ${txHash}`)
        skipped++
      }
    } catch (err) {
      console.warn(
        `  [error] #${r.agent_token_id} ${r.name}:`,
        err instanceof Error ? err.message : err,
      )
      skipped++
    }
  }

  console.log(`\nResult: ${transferred} transferred · ${alreadyAdmin} already admin · ${skipped} skipped`)
  await sql.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
