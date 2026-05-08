import { eq } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { workflows } from '../lib/db/schema'

async function main() {
  const wfs = await db.select().from(workflows).where(eq(workflows.erc8183JobId, '5349'))
  console.log('Workflow:', wfs[0])
}
main()
