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
async function tokensOf(wallet, n) {
  const tokens = []
  for (let i = 0; i < Math.min(n, 10); i++) {
    const data = '0x2f745c59' + wallet.slice(2).padStart(64, '0') + i.toString(16).padStart(64, '0')
    const r = await fetch('https://rpc.testnet.arc.network', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({jsonrpc:'2.0',method:'eth_call',params:[{to:REGISTRY,data},'latest'],id:1})
    }).then(r=>r.json())
    if (!r.error && r.result) tokens.push(parseInt(r.result, 16))
  }
  return tokens
}

const users = await sql`
  SELECT id, wallet, identity_token_id, credits, privy_id FROM users
  WHERE credits = 228 OR credits BETWEEN 220 AND 260
`
console.log(`Found ${users.length} users with credits ~228:`)
for (const u of users) {
  const bal = await balanceOf(u.wallet)
  const tokens = bal > 0 ? await tokensOf(u.wallet, bal) : []
  console.log(`\n${u.wallet}`)
  console.log(`  DB: cr=${u.credits} | nft=${u.identity_token_id ?? '(none)'} | privy=${u.privy_id ?? '(none)'}`)
  console.log(`  Chain: balance=${bal} ${tokens.length ? '| tokens: ' + tokens.join(',') : ''}`)
}
await sql.end()
