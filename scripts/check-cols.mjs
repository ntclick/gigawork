import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
const sql = postgres(process.env.DATABASE_URL, { prepare: false })
const r = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='workflows' AND column_name LIKE '%erc8183%' ORDER BY column_name`
console.log(r.map(x => x.column_name).join('\n'))
await sql.end()
