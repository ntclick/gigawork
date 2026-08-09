import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set')
}

const connectionUrl = url.replace('aws-1-ap-south-1.pooler.supabase.com', '3.109.171.244')
const client = postgres(connectionUrl, { prepare: false, max: 25, idle_timeout: 10, connect_timeout: 10 })

export const db = drizzle(client, { schema })
export type DB = typeof db
