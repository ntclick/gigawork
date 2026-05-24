import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env' })

import * as fs from 'fs'
import * as path from 'path'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const ARC_RPC = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC
if (!ARC_RPC) throw new Error('ARC_RPC_URL / NEXT_PUBLIC_ARC_RPC missing')

const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY
if (!ADMIN_PK) throw new Error('ADMIN_PRIVATE_KEY missing')

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

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
const adminAccount = privateKeyToAccount(ADMIN_PK as `0x${string}`)
const adminWallet = createWalletClient({
  account: adminAccount,
  chain: arcChain,
  transport: http(ARC_RPC),
})

const artifactPath = path.resolve(__dirname, '../contracts/CosmicRaffle.json')

async function main() {
  console.log(`\n🏗  Deploying Single Shared CosmicRaffle...`)
  console.log(`   Deployer: ${adminAccount.address}`)
  console.log(`   RPC:      ${ARC_RPC}`)

  const bal = await publicClient.getBalance({ address: adminAccount.address })
  console.log(`   Balance:  ${Number(bal) / 1e18} ETH`)
  if (bal < BigInt(1e15)) {
    throw new Error('Admin wallet has insufficient gas (< 0.001 ETH)')
  }

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Compiled artifact not found at ${artifactPath}. Run: npx tsx scripts/compile-shared.ts`)
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const { abi, bytecode } = artifact as {
    abi: unknown[]
    bytecode: `0x${string}`
  }

  const hash = await adminWallet.deployContract({
    abi,
    bytecode,
  })

  console.log(`   tx: ${hash}`)
  console.log('   Waiting for confirmation...')

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 120_000,
  })

  if (receipt.status !== 'success') {
    console.error(`❌ Deploy tx reverted: ${hash}`)
    process.exit(1)
  }

  const contractAddress = receipt.contractAddress
  if (!contractAddress) {
    console.error('❌ No contract address in receipt')
    process.exit(1)
  }

  console.log(`\n✅ CosmicRaffle deployed!`)
  console.log(`   Address:  ${contractAddress}`)
  console.log(`   Explorer: ${EXPLORER}/address/${contractAddress}`)
  console.log(`\n   Add to .env or .env.local:`)
  console.log(`   NEXT_PUBLIC_COSMIC_RAFFLE_ADDRESS=${contractAddress}\n`)
}

main().catch((e) => {
  console.error('Deploy failed:', e)
  process.exit(1)
})
