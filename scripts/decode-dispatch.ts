/**
 * decode-dispatch.ts — decode ERC-8183 envelope từ tx calldata trên Arc Testnet
 *
 * Chạy: pnpm tsx scripts/decode-dispatch.ts <txHash>
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createPublicClient, defineChain, hexToString, http } from 'viem'

const RPC = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC!
const arc = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? '5042002'),
  name: 'Arc',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})
const client = createPublicClient({ chain: arc, transport: http(RPC) })

async function main() {
  const txHash = process.argv[2] as `0x${string}` | undefined
  if (!txHash) { console.error('Cần txHash'); process.exit(1) }

  const tx = await client.getTransaction({ hash: txHash })
  console.log(`Tx        : ${tx.hash}`)
  console.log(`From      : ${tx.from}`)
  console.log(`To        : ${tx.to}`)
  console.log(`Value     : ${tx.value}`)
  console.log(`Block     : ${tx.blockNumber}`)
  console.log()
  let envelope: string
  try {
    envelope = hexToString(tx.input as `0x${string}`)
  } catch {
    envelope = '(failed to decode as utf-8)'
  }
  console.log(`Calldata raw : ${tx.input.slice(0, 80)}…`)
  console.log(`Decoded utf-8:`)
  try {
    const obj = JSON.parse(envelope)
    console.log(JSON.stringify(obj, null, 2))
  } catch {
    console.log(envelope)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
