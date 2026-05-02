/**
 * test-topup.ts — E2E test cho on-chain USDC top-up flow:
 *   1. Admin (cũng là treasury — same wallet trong dev) ký USDC.transfer 1 USDC
 *   2. POST /api/me/topup với tx_hash
 *   3. Server verify Transfer event + grant credit
 *   4. Đọc lại /api/me/ledger → row mới với tx_hash
 *   5. Replay test: POST cùng tx_hash → 409
 *   6. Validation test: POST tx_hash của tx khác (non-USDC) → 400
 *
 * Chạy:  pnpm tsx scripts/test-topup.ts [http://localhost:3001]
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createWalletClient, defineChain, encodeFunctionData, http, parseUnits, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const BASE_URL = (process.argv[2] ?? 'http://localhost:3001').replace(/\/$/, '')
const RPC = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC!
const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY!
const USDC = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`
const TREASURY = (process.env.USDC_TREASURY_ADDRESS ?? process.env.NEXT_PUBLIC_USDC_TREASURY ?? '') as `0x${string}`
const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

const arc = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? '5042002'),
  name: 'Arc',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})

const adminAccount = privateKeyToAccount(ADMIN_PK as `0x${string}`)
const adminWallet = createWalletClient({ account: adminAccount, chain: arc, transport: http(RPC) })

const erc20TransferAbi = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

async function main() {
  console.log('─── E2E Top-up flow ──────────────────────────────────')
  console.log(`Base URL : ${BASE_URL}`)
  console.log(`Admin    : ${adminAccount.address}`)
  console.log(`Treasury : ${TREASURY}`)
  console.log(`USDC     : ${USDC}`)
  console.log()

  // Cookie auth: server resolves admin user via gw_wallet cookie
  const cookie = `gw_wallet=${adminAccount.address.toLowerCase()}`
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // ① Get rate config
  console.log('① GET /api/me/topup')
  const r1 = await fetch(`${BASE_URL}/api/me/topup`, { headers: { cookie, accept: 'application/json' } })
  const text1 = await r1.text()
  if (!text1) {
    console.error(`   ✗ Empty body, status=${r1.status}`)
    process.exit(1)
  }
  const cfg = JSON.parse(text1)
  console.log('   ', cfg)
  console.log()

  const usdcAmount = 1
  const value = parseUnits(String(usdcAmount), cfg.usdcDecimals ?? 6)

  // ② Sign + send USDC.transfer
  console.log(`② Ký USDC.transfer(${TREASURY}, ${usdcAmount} USDC)…`)
  const data = encodeFunctionData({
    abi: erc20TransferAbi,
    functionName: 'transfer',
    args: [TREASURY, value],
  })
  const txHash = (await adminWallet.sendTransaction({
    to: USDC,
    data,
    value: BigInt(0),
  })) as Hex
  console.log(`   tx=${txHash}`)
  console.log(`   ${EXPLORER}/tx/${txHash}`)
  await sleep(3000)
  console.log()

  // ③ POST /api/me/topup with tx_hash → grant
  console.log('③ POST /api/me/topup { tx_hash }')
  const balBefore = (await fetch(`${BASE_URL}/api/me`, { headers: { cookie } }).then((r) => r.json())).credits
  console.log(`   credits trước : ${balBefore}`)
  const r2 = await fetch(`${BASE_URL}/api/me/topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ tx_hash: txHash }),
  })
  const j2 = await r2.json()
  console.log(`   status ${r2.status}`)
  console.log('   ', j2)
  if (!r2.ok) {
    console.error('   ✗ FAIL — top-up không cộng credit')
    process.exit(1)
  }
  const balAfter = (await fetch(`${BASE_URL}/api/me`, { headers: { cookie } }).then((r) => r.json())).credits
  console.log(`   credits sau   : ${balAfter}`)
  console.log(`   chênh lệch    : +${balAfter - balBefore}`)
  if (balAfter - balBefore !== cfg.rate * usdcAmount) {
    console.error(`   ✗ FAIL — kỳ vọng +${cfg.rate * usdcAmount}, thực tế +${balAfter - balBefore}`)
    process.exit(1)
  }
  console.log('   ✓ Pass')
  console.log()

  // ④ Replay → 409
  console.log('④ Replay POST cùng tx_hash → kỳ vọng 409')
  const r3 = await fetch(`${BASE_URL}/api/me/topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ tx_hash: txHash }),
  })
  console.log(`   status ${r3.status}`)
  const text3 = await r3.text()
  console.log('   ', text3.slice(0, 200))
  if (r3.status !== 409) {
    console.error('   ✗ FAIL — kỳ vọng 409')
    process.exit(1)
  }
  const balReplay = (await fetch(`${BASE_URL}/api/me`, { headers: { cookie } }).then((r) => r.json())).credits
  if (balReplay !== balAfter) {
    console.error(`   ✗ FAIL — replay đã cộng credit lần 2 (${balReplay} vs ${balAfter})`)
    process.exit(1)
  }
  console.log('   ✓ Pass — credit không thay đổi')
  console.log()

  // ⑤ Validation: POST với một dispatch_tx (không có Transfer event)
  console.log('⑤ POST với non-USDC tx → kỳ vọng 400')
  const r4 = await fetch(`${BASE_URL}/api/me/topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ tx_hash: '0xff537bc9a03c73b99e6be121c42f4892852d3131c22910d2a33766d884a1e169' }),
  })
  console.log(`   status ${r4.status}`)
  console.log('   ', (await r4.text()).slice(0, 200))
  if (r4.status !== 400) {
    console.error('   ✗ FAIL — kỳ vọng 400')
    process.exit(1)
  }
  console.log('   ✓ Pass')
  console.log()

  // ⑥ Ledger contains the row
  console.log('⑥ GET /api/me/ledger — kiểm tra ledger row')
  const r5 = await fetch(`${BASE_URL}/api/me/ledger`, { headers: { cookie } })
  const j5 = await r5.json() as { ledger: Array<{ delta: number; reason: string; txHash: string | null }> }
  const found = j5.ledger.find((r) => r.txHash === txHash)
  if (!found) {
    console.error('   ✗ FAIL — không tìm thấy ledger entry với tx_hash')
    process.exit(1)
  }
  console.log(`   ✓ Found: delta=${found.delta} reason=${found.reason}`)
  console.log()

  console.log('═══ TẤT CẢ ĐỀU PASS ═══')
}

main().catch((e) => { console.error(e); process.exit(1) })
