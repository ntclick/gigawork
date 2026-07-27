import { config as loadEnv } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')

loadEnv({ path: resolve(ROOT, '.env.local'), override: true })
loadEnv({ path: resolve(ROOT, '.env') })

// DNS Bypass — must run before any DB import
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    'aws-1-ap-south-1.pooler.supabase.com',
    '3.111.225.200'
  )
}

import { eq, and } from 'drizzle-orm'

async function runWorker() {
  console.log('⚙️ GigaWork Workflow Worker started. Listening for queued workflows...')

  // Dynamic imports AFTER env is loaded — required for dotenv to take effect
  const { db } = await import('../lib/db/client.js')
  const { workflows } = await import('../lib/db/schema.js')
  const { executeWorkflowRun } = await import('../lib/workflow/executor.js')

  while (true) {
    try {
      // 1. Fetch one queued workflow
      const [wf] = await db
        .select()
        .from(workflows)
        .where(eq(workflows.status, 'queued'))
        .limit(1)

      if (!wf) {
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }

      console.log(`[worker] Claiming workflow ${wf.id} (status: queued)`)

      // 2. Claim workflow (status = running)
      const [claimed] = await db
        .update(workflows)
        .set({ status: 'running' })
        .where(and(eq(workflows.id, wf.id), eq(workflows.status, 'queued')))
        .returning()

      if (!claimed) {
        // Race condition: another worker claimed it
        continue
      }

      console.log(`[worker] Processing workflow ${wf.id}...`)

      try {
        if (!wf.userId) {
          throw new Error('Workflow userId is null, cannot execute')
        }
        await executeWorkflowRun({ workflowId: wf.id, userId: wf.userId })
        console.log(`🟢 Workflow ${wf.id} execution finished.`)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`❌ Workflow ${wf.id} failed:`, errorMsg)

        await db
          .update(workflows)
          .set({ status: 'failed' })
          .where(eq(workflows.id, wf.id))
      }
    } catch (loopErr) {
      console.error('[worker] Error in workflow worker loop (likely connection error):', loopErr)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}

runWorker().catch((e) => {
  console.error('Fatal workflow worker crash:', e)
  process.exit(1)
})
