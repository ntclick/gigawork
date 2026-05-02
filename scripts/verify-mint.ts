import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createPublicClient, defineChain, http, parseAbi } from 'viem'
import postgres from 'postgres'

const ARC_RPC = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC!
const REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS ?? '0x8004A818BFB912233c491871b3d84c89A494BD9e') as `0x${string}`
const arcChain = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? '5042002'),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
})
const client = createPublicClient({ chain: arcChain, transport: http(ARC_RPC) })
const abi = parseAbi(['function tokenURI(uint256 tokenId) external view returns (string)'])

const sql = postgres(process.env.DATABASE_URL!, { prepare: false })

async function main() {
  const rows = await sql<Array<{ name: string; agent_token_id: string }>>`
    SELECT name, agent_token_id FROM skills WHERE agent_token_id IS NOT NULL ORDER BY name
  `
  console.log(`Verifying ${rows.length} minted skills against on-chain tokenURI…\n`)
  for (const r of rows) {
    const uri = await client.readContract({
      address: REGISTRY, abi, functionName: 'tokenURI', args: [BigInt(r.agent_token_id)],
    })
    const cid = uri.replace(/^ipfs:\/\//, '').slice(0, 16)
    console.log(`  #${r.agent_token_id.padStart(4)}  ${r.name.padEnd(22)}  ${cid}…`)
  }
  await sql.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
