import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env' })

async function main() {
  const { eq } = await import('drizzle-orm')
  const { db } = await import('@/lib/db/client')
  const { users } = await import('@/lib/db/schema')
  const { grantCredits, getOrCreateUser } = await import('@/lib/credits/service')
  const wallet = (process.env.DEV_WALLET ?? '0xafe6dd950dc2cf561e8daba1725e0e6840f70549').toLowerCase()
  console.log(`Granting 10,000 credits to wallet: ${wallet}...`)
  
  const user = await getOrCreateUser(wallet)
  const result = await grantCredits({
    userId: user.id,
    amount: 10000,
    reason: 'admin_test_grant',
  })
  
  const [refreshed] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
  console.log(`✓ Credits granted! New balance: ${refreshed?.credits ?? result.balance} credits.`)
}

main().catch(console.error)
