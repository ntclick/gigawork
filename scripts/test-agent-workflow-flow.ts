import { config as loadEnv } from 'dotenv'
import { privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, http, parseUnits, createPublicClient, formatUnits } from 'viem'
import { arcTestnet } from '@/lib/chain/arcTestnet'

loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env' })

async function main() {
  console.log('🧪 Starting Live Agent Wallet Escrow and Workflow Flow Test...')
  
  const pk = process.env.ADMIN_PRIVATE_KEY
  if (!pk) throw new Error('No ADMIN_PRIVATE_KEY')
  const acc = privateKeyToAccount(pk as `0x${string}`)
  const walletAddr = acc.address
  console.log(`Using Wallet: ${walletAddr}`)
  
  const APP_URL = 'http://localhost:3000'
  
  console.log('\n1. Creating workflow via HTTP POST...')
  const createRes = await fetch(`${APP_URL}/api/workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Track BTC/USDT signals using crypto-scanner strategy. Produce a Defensible Thesis.' }),
  })
  
  if (!createRes.ok) {
    const err = await createRes.json()
    throw new Error(`Failed to create workflow: ${JSON.stringify(err)}`)
  }
  
  const { id: wfId, escrow: escrowMode } = await createRes.json()
  console.log(`✓ Workflow created: ${wfId} (escrowMode: ${escrowMode})`)
  
  // 2. Prepare escrow
  console.log('\n2. Preparing escrow...')
  const prepRes = await fetch(`${APP_URL}/api/workflow/escrow/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId: wfId }),
  })
  if (!prepRes.ok) {
    const err = await prepRes.json()
    throw new Error(`Failed to prepare escrow: ${JSON.stringify(err)}`)
  }
  const prep = await prepRes.json()
  console.log(`✓ Escrow prepared. Budget: ${prep.budgetUsdc} USDC. Admin address: ${prep.adminAddress}`)
  
  // 3. Sign and submit native transaction using private key
  console.log('\n3. Sending native USDC payment transaction on Arc Testnet...')
  const localWalletClient = createWalletClient({
    account: acc,
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL)
  })
  
  const txHash = await localWalletClient.sendTransaction({
    to: prep.adminAddress as `0x${string}`,
    value: parseUnits(prep.budgetUsdc, 18)
  })
  console.log(`✓ Payment transaction submitted: ${txHash}`)
  
  // 4. Confirm escrow payment
  console.log('\n4. Confirming escrow payment with backend...')
  let confirmed = false
  let attempts = 0
  while (attempts < 15) {
    try {
      const confirmRes = await fetch(`${APP_URL}/api/workflow/escrow/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: wfId,
          paymentTxHash: txHash,
          agentWalletAddress: walletAddr
        })
      })
      const data = await confirmRes.json()
      if (confirmRes.ok && data.ok) {
        confirmed = true
        console.log(`✓ Escrow payment confirmed successfully. Job ID: ${data.jobId}`)
        break
      }
      console.log(`⏳ Waiting for transaction confirmation... (attempt ${attempts + 1}/15)`)
    } catch (e) {
      console.log(`⏳ Error confirming, retrying...`)
    }
    attempts++
    await new Promise(r => setTimeout(r, 2000))
  }
  
  if (!confirmed) {
    throw new Error('Failed to confirm escrow payment')
  }

  // 4.5. Run planning stream
  console.log('\n4.5. Running planning stream (Hermes)...')
  const streamRes = await fetch(`${APP_URL}/api/workflow/${wfId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  
  if (!streamRes.ok) {
    const err = await streamRes.json()
    throw new Error(`Failed to start planning stream: ${JSON.stringify(err)}`)
  }
  
  // Read and drain the stream
  const reader = streamRes.body?.getReader()
  if (reader) {
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      console.log(`Stream Chunk: ${chunk}`)
    }
  }
  console.log('✓ Planning stream completed and nodes populated.')

  // 5. Execute workflow
  console.log('\n5. Executing workflow...')
  const execRes = await fetch(`${APP_URL}/api/workflow/${wfId}/execute`, {
    method: 'POST',
  })
  if (!execRes.ok) {
    const err = await execRes.json()
    throw new Error(`Failed to trigger workflow execution: ${JSON.stringify(err)}`)
  }
  console.log('✓ Workflow execution triggered.')
  
  // 6. Poll status until completed or failed
  console.log('\n6. Polling workflow execution status...')
  while (true) {
    const statusRes = await fetch(`${APP_URL}/api/workflow/escrow/status?workflowId=${wfId}`)
    const statusData = await statusRes.json()
    const currentStatus = statusData.workflow?.status
    console.log(`  → Current Status: ${currentStatus}`)
    if (currentStatus === 'completed') {
      console.log('🟢 SUCCESS: Workflow execution completed!')
      break
    }
    if (currentStatus === 'failed' || currentStatus === 'error') {
      throw new Error(`Workflow execution failed with status: ${currentStatus}`)
    }
    await new Promise(r => setTimeout(r, 3000))
  }
  
  console.log('\n🎉 LIVE TEST PASSED SUCCESSFULLY!')
}

main().catch(e => {
  console.error('❌ Test crashed:', e)
  process.exit(1)
})
