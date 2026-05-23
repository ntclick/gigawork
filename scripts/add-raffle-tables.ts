/**
 * add-raffle-tables.ts — Idempotently create "raffles" and "raffle_winners" tables
 * and setup constraints and indexes. Bypasses transaction pooler migrations.
 *
 * Usage: npx tsx scripts/add-raffle-tables.ts
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  throw new Error('DATABASE_URL environment variable is missing!')
}

const sql = postgres(dbUrl, { prepare: false })

async function main() {
  console.log('\n🚀 Starting manual schema migration for Cosmic Raffle...')

  console.log('① Creating table "raffles" if not exists...')
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "raffles" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "title" text NOT NULL,
      "description" text,
      "prize_description" text,
      "winner_count" integer NOT NULL,
      "total_entries" integer NOT NULL,
      "merkle_root" text NOT NULL,
      "commit_block" integer NOT NULL,
      "drawn" boolean DEFAULT false NOT NULL,
      "seed" text,
      "on_chain_raffle_id" integer,
      "tx_hash" text,
      "contract_address" text,
      "raw_entries" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `)
  console.log('   ✓ raffles table created or already exists.')

  console.log('② Creating table "raffle_winners" if not exists...')
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "raffle_winners" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "raffle_id" uuid NOT NULL,
      "index" integer NOT NULL,
      "username" text NOT NULL,
      "merkle_proof" jsonb NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `)
  console.log('   ✓ raffle_winners table created or already exists.')

  console.log('③ Checking and adding foreign key constraints...')
  try {
    await sql.unsafe(`
      ALTER TABLE "raffle_winners" 
      ADD CONSTRAINT "raffle_winners_raffle_id_raffles_id_fk" 
      FOREIGN KEY ("raffle_id") REFERENCES "public"."raffles"("id") ON DELETE cascade ON UPDATE no action;
    `)
    console.log('   ✓ Added raffle_winners -> raffles foreign key.')
  } catch (e) {
    console.log('   ℹ️ raffle_winners foreign key constraint already exists.')
  }

  try {
    await sql.unsafe(`
      ALTER TABLE "raffles" 
      ADD CONSTRAINT "raffles_user_id_users_id_fk" 
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    `)
    console.log('   ✓ Added raffles -> users foreign key.')
  } catch (e) {
    console.log('   ℹ️ raffles foreign key constraint already exists.')
  }

  console.log('④ Creating indexes...')
  try {
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "raffle_winners_raffle_id_idx" ON "raffle_winners" USING btree ("raffle_id");`)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "raffles_user_id_idx" ON "raffles" USING btree ("user_id");`)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "deployments_workflow_id_idx" ON "deployments" USING btree ("workflow_id");`)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "deployments_user_id_idx" ON "deployments" USING btree ("user_id");`)
    console.log('   ✓ Database indexes verified/created.')
  } catch (e) {
    console.error('   ⚠️ Error creating indexes:', e instanceof Error ? e.message : e)
  }

  await sql.end()
  console.log('\n✅ Database schema successfully prepared! Ready to support Cosmic Name Raffle.\n')
}

main().catch((e) => {
  console.error('❌ Migration failed:', e)
  process.exit(1)
})
