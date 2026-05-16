import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
const sql = postgres(process.env.DATABASE_URL, { prepare: false })

const skills = await sql`
  SELECT * FROM skills WHERE agent_token_id IS NOT NULL LIMIT 5
`
console.log(`${skills.length} skills with agent_token_id`)
if (skills.length > 0) {
  console.log('cols:', Object.keys(skills[0]).join(', '))
  for (const s of skills) {
    console.log(`  ${s.name ?? s.id} → NFT #${s.agent_token_id}`)
  }
}
await sql.end()
