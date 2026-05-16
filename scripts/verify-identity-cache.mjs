import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
const sql = postgres(process.env.DATABASE_URL, { prepare: false })

const REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e'
const RPC = 'https://rpc.testnet.arc.network'

async function ownerOf(tokenId) {
  const data = '0x6352211e' + BigInt(tokenId).toString(16).padStart(64, '0')
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: REGISTRY, data }, 'latest'], id: 1 }),
  }).then((r) => r.json())
  if (r.error || !r.result || r.result.length < 66) return null
  return ('0x' + r.result.slice(-40)).toLowerCase()
}

const rows = await sql`
  SELECT id, wallet, identity_token_id FROM users WHERE identity_token_id IS NOT NULL
`
console.log(`Verifying ${rows.length} cached identity tokens...`)
let cleared = 0
for (const u of rows) {
  const owner = await ownerOf(u.identity_token_id)
  if (owner !== u.wallet.toLowerCase()) {
    console.log(`  CLEAR ${u.wallet}: cached #${u.identity_token_id} owned by ${owner ?? '(burned)'} ≠ user wallet`)
    await sql`UPDATE users SET identity_token_id=NULL, identity_tx_hash=NULL, identity_minted_at=NULL WHERE id=${u.id}`
    cleared++
  }
}
console.log(`\nCleared ${cleared} stale identityTokenId rows; ${rows.length - cleared} verified OK.`)
await sql.end()
