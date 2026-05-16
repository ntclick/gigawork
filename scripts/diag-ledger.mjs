import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
const sql = postgres(process.env.DATABASE_URL, { prepare: false })
const u = await sql`SELECT id, wallet, identity_token_id, identity_tx_hash FROM users WHERE wallet='0x77394b8cf90f39827487a9dab3a81767bbf8a9d6' LIMIT 1`
console.log('user:', u[0])
const ledger = await sql`SELECT * FROM credit_ledger WHERE user_id=${u[0].id} ORDER BY created_at`
if (ledger[0]) console.log('cols:', Object.keys(ledger[0]).join(','))
for (const r of ledger) console.log(`  ${r.created_at?.toISOString?.()} d=${r.delta} | ${r.reason} | ${r.note ?? r.ref ?? r.tx_hash ?? ''}`)
await sql.end()
