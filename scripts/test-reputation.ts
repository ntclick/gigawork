/**
 * Quick smoke test: read reputation score for tokenId 1 (should be 0).
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env' })

import { createPublicClient, defineChain, http, parseAbi } from 'viem'

const ARC_RPC = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC
const REPUTATION = process.env.REPUTATION_REGISTRY_ADDRESS as `0x${string}`

if (!ARC_RPC || !REPUTATION) {
  console.error('Missing ARC_RPC_URL or REPUTATION_REGISTRY_ADDRESS')
  process.exit(1)
}

const arcChain = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? '5042002'),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
})

const client = createPublicClient({ chain: arcChain, transport: http(ARC_RPC) })

const abi = parseAbi([
  'function getScore(uint256 tokenId) view returns (uint256)',
  'function operator() view returns (address)',
])

async function main() {
  const operator = await client.readContract({
    address: REPUTATION,
    abi,
    functionName: 'operator',
  })
  console.log(`✅ Contract alive at ${REPUTATION}`)
  console.log(`   operator = ${operator}`)

  const score = await client.readContract({
    address: REPUTATION,
    abi,
    functionName: 'getScore',
    args: [BigInt(1)],
  })
  console.log(`   score(1) = ${score}`)
  console.log('\n🎉 Reputation system is working!')
}

main().catch((e) => {
  console.error('Test failed:', e)
  process.exit(1)
})
