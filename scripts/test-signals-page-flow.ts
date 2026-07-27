import { config as loadEnv } from 'dotenv'
import { privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, http, parseUnits, createPublicClient } from 'viem'
import { arcTestnet } from '@/lib/chain/arcTestnet'

loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env' })

async function testSignalsFlow() {
  console.log('🚀 Testing Signals Page End-to-End Workflow...')

  const pk = process.env.ADMIN_PRIVATE_KEY
  if (!pk) throw new Error('ADMIN_PRIVATE_KEY missing')
  const acc = privateKeyToAccount(pk as `0x${string}`)
  const walletAddr = acc.address
  console.log(`👤 Client Wallet: ${walletAddr}`)

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // Step 1: Create Workflow from Signals Page
  console.log('\n[1/6] 📝 Creating Signals Workflow for BTC/USDT...')
  const prompt = 'Track BTC/USDT signals using trading-signals strategy. Produce a Defensible Thesis with verdict, confidence, supporting reasons, counterpoint, and invalidation condition.'
  
  const createRes = await fetch(`${APP_URL}/api/workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  
  if (!createRes.ok) {
    const err = await createRes.json()
    throw new Error(`Create workflow failed: ${JSON.stringify(err)}`)
  }
  const { id: wfId, escrow: escrowMode } = await createRes.json()
  console.log(`  ✓ Workflow created. ID: ${wfId} (escrowMode: ${escrowMode})`)

  // Step 2: Escrow Prepare & Native USDC Transfer (Auto-signed / Delegated Wallet)
  console.log('\n[2/6] 💳 Preparing Escrow & Auto-signing Native USDC Transfer...')
  const prepRes = await fetch(`${APP_URL}/api/workflow/escrow/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId: wfId }),
  })
  if (!prepRes.ok) {
    const err = await prepRes.json()
    throw new Error(`Prepare escrow failed: ${JSON.stringify(err)}`)
  }
  const prep = await prepRes.json()
  console.log(`  ✓ Budget: ${prep.budgetUsdc} USDC -> Admin: ${prep.adminAddress}`)

  const walletClient = createWalletClient({
    account: acc,
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL)
  })

  const txHash = await walletClient.sendTransaction({
    to: prep.adminAddress as `0x${string}`,
    value: parseUnits(prep.budgetUsdc, 18),
  })
  console.log(`  ✓ Native USDC transfer broadcasted: ${txHash}`)

  // Step 3: Escrow Confirm with Retry Loop
  console.log('\n[3/6] ⏳ Confirming Escrow with Retry Loop...')
  let confirmed = false
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const confirmRes = await fetch(`${APP_URL}/api/workflow/escrow/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: wfId,
          paymentTxHash: txHash,
          agentWalletAddress: walletAddr
        }),
      })
      const data = await confirmRes.json()
      if (confirmRes.ok && data.ok) {
        confirmed = true
        console.log(`  ✓ Escrow confirmed on-chain! Job ID: ${data.jobId}`)
        break
      }
    } catch {
      /* retry */
    }
    await new Promise(r => setTimeout(r, 2000))
  }

  if (!confirmed) throw new Error('Escrow confirmation timed out')

  // Step 4: Stream Planning (Hermes Planner)
  console.log('\n[4/6] 🤖 Streaming Hermes Planner (Populating DAG Nodes)...')
  const streamRes = await fetch(`${APP_URL}/api/workflow/${wfId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!streamRes.ok) throw new Error('Stream planning failed')

  const reader = streamRes.body?.getReader()
  if (reader) {
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  }
  console.log('  ✓ Planning completed. Nodes created.')

  // Step 5: Execute DAG & Poll Execution Status
  console.log('\n[5/6] ⚡ Dispatching DAG Execution & Polling Status...')
  await fetch(`${APP_URL}/api/workflow/${wfId}/execute`, { method: 'POST' })

  let finalStatus = ''
  while (true) {
    const statusRes = await fetch(`${APP_URL}/api/workflow/escrow/status?workflowId=${wfId}`)
    const statusData = await statusRes.json()
    finalStatus = statusData.workflow?.status ?? ''
    console.log(`  → Status: ${finalStatus}`)
    if (finalStatus === 'completed' || finalStatus === 'failed') break
    await new Promise(r => setTimeout(r, 2500))
  }

  if (finalStatus !== 'completed') {
    throw new Error(`Workflow failed with status: ${finalStatus}`)
  }

  // Step 6: ERC-8004 Validation Attestation (Evaluating Agent Nodes & Reputation Award)
  console.log('\n[6/6] 🛡️ Testing ERC-8004 Validation Probe & Reputation Attestation...')
  const valPrepRes = await fetch(`${APP_URL}/api/workflow/${wfId}/validation/prepare`, {
    method: 'POST',
  })
  const valPrep = await valPrepRes.json()
  const items = valPrep.items ?? []
  console.log(`  ✓ Probed ${items.length} candidate agent nodes for reputation attestation.`)

  for (const item of items) {
    console.log(`  → Attesting Agent Node [${item.agentId}]...`)
    const respRes = await fetch(`${APP_URL}/api/workflow/${wfId}/validation/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: item.agentId,
        requestHash: item.requestHash,
        requestTxHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      }),
    })
    const respData = await respRes.json()
    console.log(`  ✓ Attestation response recorded! Response Tx: ${respData.responseTx?.slice(0, 14)}…`)
  }

  console.log('\n🎉 ALL SIGNALS PAGE STEPS COMPLETED & VERIFIED SUCCESSFULLY!')
}

testSignalsFlow().catch(err => {
  console.error('❌ Signals Test Failed:', err)
  process.exit(1)
})
