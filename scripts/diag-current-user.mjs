import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
config({ path: '.env.local' })

const sql = postgres(process.env.DATABASE_URL, { prepare: false })

// All users that touched the recent OKX wallets
const wallets = ['0x4c77584f57d385e0f2996bd4ff178c93dff034c0', '0x77394b8cf90f39827487a9dab3a81767bbf8a9d6']
const users = await sql`
  SELECT id, wallet, privy_id, credits, created_at, identity_token_id
  FROM users
  WHERE wallet = ANY(${wallets})
  ORDER BY created_at
`
console.log('=== users touching recent wallets ===')
for (const u of users) {
  console.log(`${u.id} | wallet=${u.wallet} | privy=${u.privy_id ?? '(null)'} | cr=${u.credits} | nft=${u.identity_token_id ?? '(none)'}`)
}

// Recent workflows for each
for (const u of users) {
  const wf = await sql`
    SELECT id, status, created_at, erc8183_create_tx
    FROM workflows
    WHERE user_id = ${u.id}
    ORDER BY created_at DESC
    LIMIT 3
  `
  console.log(`\n--- workflows for ${u.wallet} ---`)
  for (const w of wf) {
    console.log(`  ${w.id} | ${w.status} | createTx=${w.erc8183_create_tx ?? '(none)'}`)
  }
}

await sql.end()
