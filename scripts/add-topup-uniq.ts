/**
 * add-topup-uniq.ts — đảm bảo UNIQUE trên credit_ledger.tx_hash + index user/created.
 * Chạy idempotent (IF NOT EXISTS). Drizzle-kit hay crash với schema phức tạp,
 * nên dùng SQL trực tiếp.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { prepare: false })

async function main() {
  console.log('① Kiểm tra UNIQUE constraint trên credit_ledger.tx_hash…')
  const [existing] = await sql<Array<{ exists: boolean }>>`
    SELECT EXISTS(
      SELECT 1 FROM pg_constraint
      WHERE conname = 'credit_ledger_tx_hash_unique'
    ) AS exists
  `
  if (existing.exists) {
    console.log('   ✓ UNIQUE constraint đã tồn tại — bỏ qua.')
  } else {
    // Trước khi add UNIQUE, dọn duplicates nếu có (giữ row cũ nhất)
    const dups = await sql<Array<{ tx_hash: string; cnt: number }>>`
      SELECT tx_hash, COUNT(*)::int AS cnt FROM credit_ledger
      WHERE tx_hash IS NOT NULL
      GROUP BY tx_hash
      HAVING COUNT(*) > 1
    `
    if (dups.length > 0) {
      console.log(`   ⚠ Có ${dups.length} tx_hash bị trùng — xoá row trẻ hơn.`)
      for (const d of dups) {
        await sql`
          DELETE FROM credit_ledger
          WHERE tx_hash = ${d.tx_hash}
            AND id NOT IN (
              SELECT id FROM credit_ledger
              WHERE tx_hash = ${d.tx_hash}
              ORDER BY created_at ASC
              LIMIT 1
            )
        `
      }
    }
    await sql.unsafe(`
      ALTER TABLE credit_ledger
      ADD CONSTRAINT credit_ledger_tx_hash_unique UNIQUE (tx_hash)
    `)
    console.log('   ✓ UNIQUE constraint đã thêm.')
  }

  console.log('② Kiểm tra index credit_ledger_user_created_idx…')
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx
      ON credit_ledger (user_id, created_at DESC)
  `)
  console.log('   ✓ Index OK.')

  await sql.end()
  console.log('\n✓ Migration done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
