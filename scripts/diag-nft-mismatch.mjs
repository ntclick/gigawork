import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
const sql = postgres(process.env.DATABASE_URL, { prepare: false })

const REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e'

async function balanceOf(wallet) {
  const data = '0x70a08231' + wallet.slice(2).padStart(64, '0')
  const r = await fetch('https://rpc.testnet.arc.network', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0',method:'eth_call',params:[{to:REGISTRY,data},'latest'],id:1})
  }).then(r=>r.json())
  return parseInt(r.result, 16)
}
async function tokenOfOwnerByIndex(wallet, i) {
  const data = '0x2f745c59' + wallet.slice(2).padStart(64, '0') + i.toString(16).padStart(64, '0')
  const r = await fetch('https://rpc.testnet.arc.network', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0',method:'eth_call',params:[{to:REGISTRY,data},'latest'],id:1})
  }).then(r=>r.json())
  if (r.error) return null
  return parseInt(r.result, 16)
}

const r = await sql`
  SELECT id, wallet, privy_id, credits, identity_token_id FROM users
  WHERE credits > 0
  ORDER BY credits DESC
`
console.log(`Found ${r.length} users with credits:`)
for (const u of r) {
  const onChainBalance = await balanceOf(u.wallet)
  let chainTokens = []
  if (onChainBalance > 0) {
    for (let i = 0; i < onChainBalance && i < 5; i++) {
      const t = await tokenOfOwnerByIndex(u.wallet, i)
      if (t !== null) chainTokens.push(t)
    }
  }
  console.log(`${u.wallet}`)
  console.log(`  DB: cr=${u.credits} | nft=${u.identity_token_id ?? '(none)'} | privy=${u.privy_id ? 'yes' : 'no'}`)
  console.log(`  Chain: balance=${onChainBalance} ${chainTokens.length ? '| tokens: ' + chainTokens.join(',') : ''}`)
}
await sql.end()
