import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'
import { curlFetchJSON } from '@/lib/skills/curlFetch'

const sql = postgres(process.env.DATABASE_URL!, { prepare: false })

async function main() {
  interface Metadata {
    supportedTrust?: string[]
    services?: Array<{ endpoint?: string }>
  }

  const rows = await sql<Array<{ name: string; agent_token_id: string; manifest: Record<string, unknown> }>>`
    SELECT name, agent_token_id, manifest FROM skills WHERE agent_token_id IS NOT NULL ORDER BY name
  `
  const gateway = (process.env.PINATA_GATEWAY ?? 'https://gateway.pinata.cloud/ipfs/').replace(/\/$/, '/')
  console.log(`Fetching ${rows.length} ERC-8004 metadata blobs from IPFS via Pinata gateway…\n`)

  let okCount = 0
  for (const r of rows) {
    const manifest = r.manifest as { on_chain?: { ipfs_uri?: string } } | null
    const ipfsUri: string | undefined = manifest?.on_chain?.ipfs_uri
    if (!ipfsUri) { console.log(`  ✗ ${r.name}  no ipfs_uri in manifest`); continue }
    const cid = ipfsUri.replace(/^ipfs:\/\//, '')
    try {
      const meta = await curlFetchJSON<Metadata>(`${gateway}${cid}`, { method: 'GET', timeoutMs: 15_000 })
      const hasTrust = Array.isArray(meta.supportedTrust) && meta.supportedTrust.includes('reputation')
      const endpoint = meta.services?.[0]?.endpoint ?? '(none)'
      const isLocal = endpoint.includes('localhost') || endpoint.includes('127.0.0.1')
      const flag = hasTrust && !isLocal ? '✓' : '✗'
      if (hasTrust && !isLocal) okCount++
      console.log(`  ${flag} #${r.agent_token_id.padStart(4)} ${r.name.padEnd(20)} trust=${hasTrust ? 'reputation' : 'MISSING'}  endpoint=${endpoint}`)
    } catch (e) {
      console.log(`  ✗ ${r.name}  fetch failed: ${(e as Error).message}`)
    }
  }
  console.log(`\n${okCount}/${rows.length} agents pass ERC-8004 metadata schema check`)
  await sql.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
