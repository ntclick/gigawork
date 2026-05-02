/**
 * test-workflow.ts — E2E thật cho luồng ERC-8004 + ERC-8183:
 *
 *   1. Đảm bảo admin user (wallet = ADMIN) đã link với client NFT #2917
 *   2. Đảm bảo có đủ credits (top-up nếu thiếu)
 *   3. Tạo workflow + seed user prompt vào DB
 *   4. Gọi streamBrain() trực tiếp (không qua HTTP) → drain stream
 *   5. Đọc lại nodes + messages → in dispatch_tx, output, final report
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

const ADMIN_WALLET = '0xafe6dd950dc2cf561e8daba1725e0e6840f70549'
const CLIENT_TOKEN_ID = '2917'
const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

const DEFAULT_PROMPT =
  'Quét token ETH trên Ethereum (0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2), ' +
  'lấy tín hiệu kỹ thuật ETH/USDT 4h trên binance, ' +
  'sau đó tổng hợp thành báo cáo ngắn cho nhà đầu tư.'

async function main() {
  // Lazy-import sau khi env đã load (db client đọc DATABASE_URL ở top-level)
  const { eq } = await import('drizzle-orm')
  const { streamBrain } = await import('../lib/ai/brain')
  const { db } = await import('../lib/db/client')
  const { messages, nodes, users, workflows } = await import('../lib/db/schema')

  const prompt = process.argv.slice(2).join(' ').trim() || DEFAULT_PROMPT

  console.log('─── Workflow E2E test ───────────────────────────────')
  console.log(`Prompt: ${prompt}\n`)

  // Đảm bảo admin user link với client NFT #2917 + đủ credits
  const [u] = await db.select().from(users).where(eq(users.wallet, ADMIN_WALLET)).limit(1)
  let user
  if (!u) {
    const [created] = await db
      .insert(users)
      .values({
        wallet: ADMIN_WALLET,
        credits: 1000,
        identityTokenId: CLIENT_TOKEN_ID,
        identityTxHash: '0xe9398a4a52a98136f2a24450e8a7d413dd9b2dbb095dee0fee6c2afe92ab5073',
        identityMintedAt: new Date(),
      })
      .returning()
    user = created
  } else {
    const patch: Record<string, unknown> = {}
    if (u.identityTokenId !== CLIENT_TOKEN_ID) {
      patch.identityTokenId = CLIENT_TOKEN_ID
      patch.identityTxHash = '0xe9398a4a52a98136f2a24450e8a7d413dd9b2dbb095dee0fee6c2afe92ab5073'
      patch.identityMintedAt = new Date()
    }
    if (u.credits < 200) patch.credits = 1000
    if (Object.keys(patch).length) {
      await db.update(users).set(patch as any).where(eq(users.id, u.id))
    }
    user = { ...u, ...patch } as typeof u
  }

  console.log(`User    : ${user.wallet}`)
  console.log(`UserId  : ${user.id}`)
  console.log(`Identity: #${CLIENT_TOKEN_ID}\n`)

  const [wf] = await db.insert(workflows).values({ prompt, userId: user.id }).returning()
  console.log(`Workflow created: ${wf.id}\n`)

  await db.insert(messages).values({ workflowId: wf.id, role: 'user', content: prompt })

  console.log('① Streaming brain (Kimi)…')
  const t0 = Date.now()
  const result = await streamBrain({
    workflowId: wf.id,
    userId: user.id,
    uiMessages: [{ id: 'seed', role: 'user' as const, parts: [{ type: 'text' as const, text: prompt }] }] as any,
  })

  let chunks = 0
  let textLen = 0
  let toolCalls = 0
  for await (const part of (result as any).fullStream) {
    chunks++
    if (part.type === 'text-delta' || part.type === 'text') textLen += (part.text ?? part.textDelta ?? '').length
    if (part.type === 'tool-call') {
      toolCalls++
      console.log(`   → tool-call: ${part.toolName}`)
    }
    if (part.type === 'error') console.log(`   ! error: ${JSON.stringify(part.error).slice(0, 200)}`)
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`   ✓ stream done (${chunks} chunks, ${toolCalls} tool calls, ${textLen} chars text, ${dt}s)\n`)

  const wfFinal = await db.query.workflows.findFirst({ where: eq(workflows.id, wf.id) })
  const nodeRows = await db.query.nodes.findMany({ where: eq(nodes.workflowId, wf.id) })
  const msgRows = await db.query.messages.findMany({ where: eq(messages.workflowId, wf.id) })

  console.log('② Workflow state:')
  console.log(`   status   : ${wfFinal?.status}`)
  console.log(`   nodes    : ${nodeRows.length}`)
  console.log(`   messages : ${msgRows.length}\n`)

  console.log('③ Nodes (mỗi cái là một on-chain dispatch tx ERC-8183):')
  for (const n of nodeRows) {
    const out = (n.output ?? {}) as Record<string, unknown>
    const tx = (out.dispatch_tx as string | null) ?? null
    const errKey = out.error
    const detail = tx ? `tx=${EXPLORER}/tx/${tx}` : errKey ? `error=${String(errKey).slice(0, 60)}` : '(no tx)'
    console.log(`   • ${n.label.padEnd(30)} status=${n.status.padEnd(10)} ${detail}`)
  }
  console.log()

  console.log('④ Final brain message (Kimi report):')
  const finals = msgRows.filter((m) => m.role === 'brain')
  if (finals.length === 0) {
    console.log('   (chưa có final brain message — kiểm tra Kimi)')
  } else {
    const last = finals[finals.length - 1]
    const md = (last.content ?? '').trim()
    console.log('   ──── BEGIN REPORT ' + '─'.repeat(40))
    console.log(md.split('\n').map((l) => '   ' + l).join('\n'))
    console.log('   ──── END REPORT ' + '─'.repeat(42))
  }

  console.log(`\n✓ E2E xong. Workflow: /workflow/${wf.id}`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
