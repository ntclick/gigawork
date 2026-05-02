import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL missing')
const sql = postgres(url, { prepare: false })

async function main() {
  const wallet = '0xdef0000000000000000000000000000000000001' // anonymous default
  await sql.unsafe(`UPDATE users SET credits = 1000 WHERE wallet = $1`, [wallet])
  const [u] = await sql.unsafe(`SELECT wallet, credits FROM users WHERE wallet = $1`, [wallet])
  console.log('granted:', u)
  await sql.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
