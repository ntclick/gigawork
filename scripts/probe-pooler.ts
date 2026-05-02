import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'

const PROJECTS = ['otgxkxcdevmmwnbhumug', 'yxnmthhkvmjuuapsbchw']
const PASSWORD = '123Batdau%23%40%21'
const REGIONS = [
  'ap-southeast-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'eu-central-1',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'eu-west-1',
]

async function tryOnce(project: string, region: string): Promise<{ ok: boolean; msg: string }> {
  const url = `postgres://postgres.${project}:${PASSWORD}@aws-0-${region}.pooler.supabase.com:6543/postgres`
  const sql = postgres(url, { prepare: false, connect_timeout: 6 })
  try {
    await sql`select 1`
    await sql.end()
    return { ok: true, msg: url }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    await sql.end({ timeout: 1 }).catch(() => {})
    return { ok: false, msg }
  }
}

async function main() {
  for (const project of PROJECTS) {
    for (const region of REGIONS) {
      // 3 retries per region+project to dodge transient DNS
      for (let attempt = 1; attempt <= 3; attempt++) {
        const r = await tryOnce(project, region)
        if (r.ok) {
          console.log(`✓ ${project} @ ${region} (try ${attempt})`)
          console.log('USE_URL=' + r.msg)
          return
        }
        const trimmed = r.msg.slice(0, 80)
        console.log(`✗ ${project} @ ${region} try ${attempt}: ${trimmed}`)
        if (trimmed.includes('not found')) break // skip retries — pooler said not here
      }
    }
  }
  console.log('NO_REGION_FOUND')
}
main()
