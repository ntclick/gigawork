import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

import { resolve } from 'path'
loadEnv({ path: resolve(process.cwd(), '.env') })
loadEnv({ path: resolve(process.cwd(), '.env.local'), override: true })

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  casing: 'snake_case',
})
