import postgres from 'postgres'
import { config } from 'dotenv'
config({ path: '.env' })
config({ path: '.env.local' })

const sql = postgres(process.env.DATABASE_URL, { prepare: false })

// Show before state
const before = await sql`
  SELECT id, wallet, credits, identity_token_id,
    (SELECT COUNT(*) FROM credit_ledger WHERE user_id = users.id AND reason='signup_grant')::int AS signup_count
  FROM users
  ORDER BY credits DESC
  LIMIT 30
`
console.log('=== BEFORE ===')
for (const u of before) {
  console.log(`${u.wallet} | cr=${u.credits} | nft=${u.identity_token_id ?? '(none)'} | signups=${u.signup_count}`)
}

// For each user that has multiple signup_grant ledger rows (from past
// wallet-flip merges), keep the OLDEST one and delete the rest. Subtract
// the deleted deltas from users.credits.
const dupes = await sql`
  SELECT user_id, COUNT(*)::int AS n, SUM(delta)::int AS total_delta
  FROM credit_ledger
  WHERE reason='signup_grant'
  GROUP BY user_id
  HAVING COUNT(*) > 1
`
console.log(`\n${dupes.length} users with duplicate signup_grant rows`)

for (const d of dupes) {
  await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, delta FROM credit_ledger
      WHERE user_id = ${d.user_id} AND reason='signup_grant'
      ORDER BY created_at ASC
    `
    const keep = rows[0]
    const drop = rows.slice(1)
    const dropDelta = drop.reduce((s, r) => s + r.delta, 0)
    if (drop.length === 0) return
    await tx`DELETE FROM credit_ledger WHERE id IN ${tx(drop.map((r) => r.id))}`
    await tx`UPDATE users SET credits = credits - ${dropDelta} WHERE id = ${d.user_id}`
    console.log(`  ${d.user_id}: dropped ${drop.length} dup ledger rows, deducted ${dropDelta} cr (kept ${keep.id})`)
  })
}

// Also: users with credits>0 but NO identity_token_id and no signup_grant
// ledger — these were granted credits via the old buggy path before the
// signup_grant ledger was even introduced, OR via wallet-flip merges
// from rows that got deleted before their signup_grant could be tracked.
// Reset their credits to 0 since they haven't actually minted an NFT.
const ghostGrants = await sql`
  SELECT id, wallet, credits FROM users
  WHERE credits > 0
    AND identity_token_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM credit_ledger
      WHERE user_id = users.id AND reason='signup_grant'
    )
`
console.log(`\n${ghostGrants.length} users with ghost credits (no NFT, no ledger row)`)
for (const u of ghostGrants) {
  await sql`UPDATE users SET credits = 0 WHERE id = ${u.id}`
  console.log(`  reset ${u.wallet}: ${u.credits} → 0`)
}

// Show after state
const after = await sql`
  SELECT wallet, credits, identity_token_id,
    (SELECT COUNT(*) FROM credit_ledger WHERE user_id = users.id AND reason='signup_grant')::int AS signup_count
  FROM users
  ORDER BY credits DESC
  LIMIT 30
`
console.log('\n=== AFTER ===')
for (const u of after) {
  console.log(`${u.wallet} | cr=${u.credits} | nft=${u.identity_token_id ?? '(none)'} | signups=${u.signup_count}`)
}

await sql.end()
