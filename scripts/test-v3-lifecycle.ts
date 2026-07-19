import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env' })

// DNS Bypass for Supabase pooler
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    'aws-1-ap-south-1.pooler.supabase.com',
    '3.111.225.200'
  )
}

import { eq } from 'drizzle-orm'
import { keccak256, toHex, parseAbi, encodeFunctionData } from 'viem'

async function runE2ETests() {
  console.log('🚀 Starting GigaWork v3 End-to-End Lifecycle Test on Arc Testnet...')
  const startTime = Date.now()

  // Dynamically import env-dependent modules
  const { db } = await import('../lib/db/client')
  const { agents, jobs } = await import('../lib/db/schema')
  const { createAgentWallet, sendAgentTransaction } = await import('../lib/circle/wallet')
  const { registerAgent } = await import('../lib/arc/identity')
  const { upsertAgent, updateAgentReputation } = await import('../lib/supabase/agents')
  const { matchAgent } = await import('../lib/hermes/match')
  const { appendNegotiationMessage } = await import('../lib/supabase/chat')
  const { executeNegotiationRound } = await import('../lib/hermes/negotiate')
  const { createAndFundEscrowJob, submitEscrowDeliverable, completeEscrowJob } = await import('../lib/arc/job')
  const { updateJobStatus } = await import('../lib/supabase/jobs')
  const { submitValidationRequest, submitValidationResponse } = await import('../lib/arc/validation')
  const { giveFeedback, getReputationScore } = await import('../lib/arc/reputation')
  const { adminAccount, publicClient } = await import('../lib/chain/client')
  const { USDC_CONTRACT } = await import('../contracts/addresses')
  const { trackTransaction } = await import('../lib/chain/tracker')

  // Ensure admin account exists
  const adminAddr = adminAccount?.address
  if (!adminAddr) {
    throw new Error('Admin wallet is not configured (ADMIN_PRIVATE_KEY missing from .env)')
  }
  console.log(`✅ Admin wallet: ${adminAddr}`)

  // 1. Setup client & provider EOA wallets (using stable private keys for reuse)
  console.log('\n--- Step 1: Resolving Local Agent Wallets ---')
  const clientWalletId = '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b'
  const providerWalletId = '0x6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c'
  
  const { getAgentAccount, prefundAgentWallet } = await import('../lib/circle/wallet')
  const clientAccountInstance = getAgentAccount(clientWalletId)
  const providerAccountInstance = getAgentAccount(providerWalletId)
  
  const clientAddress = clientAccountInstance.address
  const providerAddress = providerAccountInstance.address
  
  console.log(`   Client Agent address: ${clientAddress}`)
  console.log(`   Provider Agent address: ${providerAddress}`)

  // 2 & 3. Register Client & Provider Agents
  console.log('\n--- Step 2 & 3: Resolving Agent Registration ---')
  const clientOwner = `0x${'1'.repeat(40)}`
  const providerOwner = `0x${'2'.repeat(40)}`

  // Check if they already exist in database
  const { getAgentByAddress } = await import('../lib/supabase/agents')
  let clientAgent = await getAgentByAddress(clientAddress)
  let providerAgent = await getAgentByAddress(providerAddress)

  if (clientAgent && providerAgent) {
    console.log('   Reusing existing registered agents from database cache to skip on-chain registration...')
    // Prefund them just in case they need gas/USDC
    await Promise.all([
      prefundAgentWallet(clientAddress),
      prefundAgentWallet(providerAddress)
    ])
  } else {
    console.log('   Agents not found in DB cache. Registering Client & Provider Agents on-chain in parallel...')
    const [clientReg, providerReg] = await Promise.all([
      registerAgent(clientWalletId, clientAddress, {
        name: 'E2E Static Client',
        description: 'E2E Test Client Agent',
        capabilities: ['request_work'],
        type: 'client',
      }),
      registerAgent(providerWalletId, providerAddress, {
        name: 'E2E Static Provider',
        description: 'E2E Test Provider Agent',
        capabilities: ['data_scraping', 'content_creation'],
        type: 'provider',
      })
    ])

    clientAgent = await upsertAgent({
      onchainId: BigInt(clientReg.tokenId),
      ownerAddress: clientOwner,
      agentType: 'client',
      name: 'E2E Static Client',
      description: 'E2E Test Client Agent',
      capabilities: ['request_work'],
      walletId: clientWalletId,
      walletAddress: clientAddress,
      metadataUri: clientReg.metadataUri,
      reputationScore: '0',
      isActive: true,
    })

    providerAgent = await upsertAgent({
      onchainId: BigInt(providerReg.tokenId),
      ownerAddress: providerOwner,
      agentType: 'provider',
      name: 'E2E Static Provider',
      description: 'E2E Test Provider Agent',
      capabilities: ['data_scraping', 'content_creation'],
      walletId: providerWalletId,
      walletAddress: providerAddress,
      metadataUri: providerReg.metadataUri,
      reputationScore: '0',
      isActive: true,
    })
    console.log(`✅ Client Agent registered. On-chain ID: ${clientReg.tokenId}`)
    console.log(`✅ Provider Agent registered. On-chain ID: ${providerReg.tokenId}`)
  }

  // 4. Test Matchmaker
  console.log('\n--- Step 4: Testing Matchmaker Engine ---')
  const matches = await matchAgent('data_scraping', 0)
  const matchedProvider = matches.find((m) => m.id === providerAgent.id)
  if (!matchedProvider) {
    throw new Error('Matchmaker failed: newly registered provider agent with capability "data_scraping" was not matched!')
  }
  console.log(`✅ Matchmaker successfully returned Provider Agent: ${matchedProvider.name}`)

  // Create mock job in DB
  const [testJob] = await db
    .insert(jobs)
    .values({
      clientAgentId: clientAgent.id,
      providerAgentId: providerAgent.id,
      status: 'Open',
      budgetUsdc: '0.1',
      description: 'Scrape 10 pages of token metrics data',
    })
    .returning()
  console.log(`   Created database job entry with ID: ${testJob.id}`)

  // 5. Test LLM negotiation loop (mocked for execution speed and determinism)
  console.log('\n--- Step 5: Testing LLM Negotiation Round (Mocked) ---')
  await appendNegotiationMessage({
    jobId: testJob.id,
    agentId: clientAgent.id,
    role: 'client',
    message: 'Hello, I would like to offer 0.05 USDC for scraping token metrics.',
    priceOffer: '0.05',
  })

  console.log(`   Starting negotiation round 1 (Mocked)...`)
  const providerResponse = {
    priceOffer: 0.15,
    message: 'Scraping 10 pages of token metrics data involves moderate effort. I counter-offer 0.15 USDC.',
    accepted: false
  }
  console.log(`   Provider Counter-Offer: ${providerResponse.priceOffer} USDC`)
  console.log(`   Provider Message: "${providerResponse.message}"`)
  console.log(`   Provider Decision: Negotiate`)

  await appendNegotiationMessage({
    jobId: testJob.id,
    agentId: providerAgent.id,
    role: 'provider',
    message: providerResponse.message,
    priceOffer: providerResponse.priceOffer.toString(),
  })

  console.log(`   Client Agent accepting Provider Counter-Offer of ${providerResponse.priceOffer} USDC...`)
  await appendNegotiationMessage({
    jobId: testJob.id,
    agentId: clientAgent.id,
    role: 'client',
    message: `That price is fair. I accept your counter-offer of ${providerResponse.priceOffer} USDC.`,
    priceOffer: providerResponse.priceOffer.toString(),
  })

  const currentOffer = 0.15
  console.log(`✅ Negotiation successful! Agreed price: ${currentOffer} USDC.`)

  // Update DB agreed job budget
  const [agreedJob] = await db
    .update(jobs)
    .set({ budgetUsdc: currentOffer.toString() })
    .where(eq(jobs.id, testJob.id))
    .returning()

  // 6. Fund Escrow On-Chain
  console.log('\n--- Step 6: Funding On-Chain Escrow Job ---')
  const fundResult = await createAndFundEscrowJob({
    clientPrivateKey: clientAgent.walletId!,
    clientAddress: clientAgent.walletAddress!,
    providerAddress: providerAgent.walletAddress!,
    evaluatorAddress: adminAddr,
    budgetUsdc: agreedJob.budgetUsdc || '0.05',
    description: agreedJob.description || 'E2E Escrow Job',
    providerPrivateKey: providerAgent.walletId || undefined,
  })
  console.log(`✅ Escrow funded! On-chain job ID: ${fundResult.jobId}`)
  console.log(`   Create Tx: ${fundResult.createTx}`)
  console.log(`   Fund Tx: ${fundResult.fundTx}`)

  // Update job status in DB
  const dbJobFunded = await updateJobStatus(testJob.id, 'Funded', {
    onchainJobId: BigInt(fundResult.jobId),
    fundedAt: new Date(),
  })

  // 7. Submit deliverable
  console.log('\n--- Step 7: Submitting Deliverables ---')
  const submitTx = await submitEscrowDeliverable({
    providerPrivateKey: providerAgent.walletId!,
    providerAddress: providerAgent.walletAddress!,
    jobId: fundResult.jobId,
    deliverableSeed: 'E2E Scraping deliverable data pack',
  })
  console.log(`✅ Deliverable submitted! Tx Hash: ${submitTx}`)

  // Update job status in DB
  const dbJobSubmitted = await updateJobStatus(testJob.id, 'Submitted', {
    deliverableHash: submitTx,
  })

  // 8. Attestation request, response and completion
  console.log('\n--- Step 8: Validation Request & Job Completion ---')
  const requestHash = keccak256(toHex(`gw-validation:${testJob.id}`))
  const reasonSeed = `completion-reason-${testJob.id}-${Date.now()}`

  console.log('   Running Validation, Escrow Completion, and Feedback in parallel...')
  const [validationResponseTx, completeTx, feedbackTx] = await Promise.all([
    // A & B: Validation Flow (sequentially nested, but runs in parallel with others)
    (async () => {
      console.log('   [parallel] Submitting validation request (ERC-8004)...')
      const reqTx = await submitValidationRequest(
        providerAgent.walletId!,
        providerAgent.onchainId!.toString(),
        adminAddr,
        requestHash
      )
      console.log(`   [parallel] Validation Request Tx: ${reqTx}`)

      console.log('   [parallel] Submitting validation response from Admin Validator...')
      const resTx = await submitValidationResponse(
        requestHash,
        'job_completed'
      )
      console.log(`   [parallel] Validation Response Tx: ${resTx}`)
      return resTx
    })(),

    // C: Escrow Completion Flow
    (async () => {
      console.log('   [parallel] Completing escrow job on-chain (releasing USDC)...')
      const tx = await completeEscrowJob({
        evaluatorPrivateKey: process.env.ADMIN_PRIVATE_KEY as `0x${string}`,
        evaluatorAddress: adminAddr,
        jobId: fundResult.jobId,
        reasonSeed,
      })
      console.log(`   [parallel] Escrow Complete Tx: ${tx}`)
      return tx
    })(),

    // D: Feedback Flow
    (async () => {
      console.log('   [parallel] Submitting reputation feedback on-chain...')
      const tx = await giveFeedback(
        clientAgent.walletId!,
        providerAgent.onchainId!.toString(),
        5,
        'E2E Test: Excellent work!'
      )
      console.log(`   [parallel] Feedback Tx: ${tx}`)
      return tx
    })()
  ])

  // E. Synchronize DB cache
  console.log('   Synchronizing Agent reputation score in DB...')
  const freshScore = await getReputationScore(providerAgent.onchainId!.toString())
  await updateAgentReputation(providerAgent.id, freshScore.toString())
  console.log(`   Updated reputation score in DB: ${freshScore}`)

  // F. Complete DB Status
  await updateJobStatus(testJob.id, 'Completed', {
    completedAt: new Date(),
  })
  console.log('✅ Job completed and reputation updated!')

  // 9. Verify Provider Balance and Withdrawal
  console.log('\n--- Step 9: Verifying Provider Balance and Withdrawal ---')
  const usdcAbi = parseAbi(['function balanceOf(address a) view returns (uint256)'])
  const providerUsdcBal = await publicClient.readContract({
    address: USDC_CONTRACT as `0x${string}`,
    abi: usdcAbi,
    functionName: 'balanceOf',
    args: [providerAgent.walletAddress as `0x${string}`],
  })
  console.log(`   Provider Agent USDC balance: ${providerUsdcBal.toString()}`)

  if (providerUsdcBal === 0n) {
    throw new Error('USDC balance not received by the provider agent!')
  }

  console.log(`   Withdrawing USDC back to admin address...`)
  const withdrawData = encodeFunctionData({
    abi: parseAbi(['function transfer(address recipient, uint256 amount) returns (bool)']),
    functionName: 'transfer',
    args: [adminAddr, providerUsdcBal],
  })
  const withdrawTx = await sendAgentTransaction(providerAgent.walletId!, {
    to: USDC_CONTRACT as `0x${string}`,
    data: withdrawData,
  })
  console.log(`   Withdraw Tx: ${withdrawTx}`)

  // 10. Test Transaction Status Tracker
  console.log('\n--- Step 10: Testing Transaction Status Tracker ---')
  let trackerFired = false
  const trackerPromise = new Promise<void>((resolve) => {
    trackTransaction(withdrawTx, async () => {
      trackerFired = true
      console.log('   [tracker callback] Callback successfully fired!')
      resolve()
    })
  })

  // Wait for the tracker callback to fire
  await Promise.race([
    trackerPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Tracker callback timed out!')), 60_000))
  ])

  if (!trackerFired) {
    throw new Error('Transaction tracker callback did not execute!')
  }
  console.log('✅ Transaction tracker test passed!')

  console.log(`\n🎉 E2E Lifecycle test completed successfully in ${((Date.now() - startTime) / 1000).toFixed(2)}s!`)
}

runE2ETests().catch((e) => {
  console.error('\n❌ E2E Lifecycle test failed:', e)
  process.exit(1)
})
