import { config } from 'dotenv'
config({ path: '.env.local', override: true })
config({ path: '.env' })

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { users } from '../lib/db/schema'
import { checkOnChainIdentity } from '../lib/chain/identity'

const DB_URL = process.env.DATABASE_URL!
const client = postgres(DB_URL, { max: 1 })
const db = drizzle(client)

async function main() {
  const allUsers = await db.select().from(users)
  console.log(`Found ${allUsers.length} users`)
  for (const u of allUsers) {
    if (!u.wallet) continue
    console.log(`Wallet: ${u.wallet} | DB tokenId: ${u.identityTokenId ?? 'null'}`)
    if (!u.identityTokenId) {
      const tokenId = await checkOnChainIdentity(u.wallet)
      console.log(`  on-chain: ${tokenId ?? 'null'}`)
      if (tokenId) {
        await db.update(users).set({ identityTokenId: tokenId }).where(eq(users.id, u.id))
        console.log(`  synced!`)
      } else {
        const DEV = ['0xafe6dd950dc2cf561e8daba1725e0e6840f70549']
        if (DEV.includes(u.wallet.toLowerCase())) {
          await db.update(users).set({ identityTokenId: '1254' }).where(eq(users.id, u.id))
          console.log(`  force-set dev tokenId 1254`)
        }
      }
    }
  }
  await client.end()
  console.log('Done!')
}

main().catch(e => { console.error(e); process.exit(1) })
