import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set')
}

// Bypass Node DNS transient ENOTFOUND errors by resolving supabase pooler domain to IP
const resolvedUrl = url.replace('aws-1-ap-south-1.pooler.supabase.com', '3.111.225.200')

const client = postgres(resolvedUrl, { prepare: false, max: 5, idle_timeout: 20 })

export const db = drizzle(client, { schema })
export type DB = typeof db
