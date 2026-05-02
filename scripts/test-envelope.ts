/**
 * test-envelope.ts — test that brain handles structured envelope correctly.
 * Submits a real form-shaped prompt to streamBrain() and checks tool calls.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

const ADMIN_WALLET = '0xafe6dd950dc2cf561e8daba1725e0e6840f70549'
const CLIENT_TOKEN_ID = '2917'
const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

const ENVELOPE = `Chạy crypto-scanner với params dưới đây rồi chain qua report-composer, finalize report.

[INTENT=safe-or-rug via crypto-scanner]
chain: ethereum
token_address: 0x6982508145454ce325ddbe47a25d4ec3d2311933
followup_skills: report-composer

User note: "Tôi định mua $200 PEPE, có nên không?"`

async function main() {
  const { eq } = await import('drizzle-orm')
  const { streamBrain } = await import('../lib/ai/brain')
  const { db } = await import('../lib/db/client')
  const { messages, nodes, users, workflows } = await import('../lib/db/schema')

  console.log('─── Envelope test ─────────────────────────────────────')
  console.log(ENVELOPE)
  console.log('───────────────────────────────────────────────────────\n')

  const [u] = await db.select().from(users).where(eq(users.wallet, ADMIN_WALLET)).limit(1)
  if (!u) throw new Error('admin user not found')
  if (u.identityTokenId !== CLIENT_TOKEN_ID) {
    await db.update(users).set({ identityTokenId: CLIENT_TOKEN_ID }).where(eq(users.id, u.id))
  }
  if (u.credits < 200) {
    await db.update(users).set({ credits: 1000 }).where(eq(users.id, u.id))
  }

  const [wf] = await db.insert(workflows).values({ prompt: ENVELOPE, userId: u.id }).returning()
  await db.insert(messages).values({ workflowId: wf.id, role: 'user', content: ENVELOPE })

  console.log(`Workflow ${wf.id}\n① Streaming brain…`)
  const t0 = Date.now()
  const result = await streamBrain({
    workflowId: wf.id,
    userId: u.id,
    uiMessages: [{ id: 'seed', role: 'user' as const, parts: [{ type: 'text' as const, text: ENVELOPE }] }] as any,
  })

  let toolCalls = 0
  for await (const part of (result as any).fullStream) {
    if (part.type === 'tool-call') {
      toolCalls++
      console.log(`   → tool-call: ${part.toolName} ${JSON.stringify(part.input).slice(0, 120)}`)
    }
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`   ✓ stream done (${toolCalls} tool calls, ${dt}s)\n`)

  const nodeRows = await db.query.nodes.findMany({ where: eq(nodes.workflowId, wf.id) })
  console.log(`② Nodes (${nodeRows.length}):`)
  for (const n of nodeRows) {
    const out = (n.output ?? {}) as Record<string, unknown>
    const tx = out.dispatch_tx as string | null
    console.log(`   • ${n.label.padEnd(28)} status=${n.status.padEnd(10)} ${tx ? EXPLORER + '/tx/' + tx : ''}`)
  }

  const msgRows = await db.query.messages.findMany({ where: eq(messages.workflowId, wf.id) })
  const final = msgRows.filter((m) => m.role === 'brain').pop()
  console.log(`\n③ Final brain output:`)
  if (final?.content) {
    console.log(final.content.split('\n').map((l) => '   ' + l).join('\n'))
  } else {
    console.log('   (none)')
  }

  console.log(`\nWorkflow URL: /workflow/${wf.id}`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
