import { config } from 'dotenv'
config({ path: '.env.local', override: true })
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 1 })

const rows = await sql`
  UPDATE users
  SET identity_token_id = '1254'
  WHERE wallet = '0xafe6dd950dc2cf561e8daba1725e0e6840f70549'
  RETURNING wallet, identity_token_id
`
console.log('Updated:', JSON.stringify(rows))
await sql.end()
