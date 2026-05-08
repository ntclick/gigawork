import { eq } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { messages } from '../lib/db/schema'

async function main() {
  const msgs = await db.select().from(messages).where(eq(messages.workflowId, 'cfd2c6f0-fa17-495c-9c40-0be36682b1f0')).orderBy(messages.createdAt)
  msgs.forEach(m => {
    if (m.toolName === 'dispatchSkill') {
      console.log('Skill:', m.toolPayload?.skill_name, 'OK:', m.toolPayload?.ok, 'Error:', m.toolPayload?.error)
    }
  })
}
main()
