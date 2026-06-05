import { privateKeyToAccount } from 'viem/accounts'
import { randomBytes } from 'crypto'
import { type Hex } from 'viem'

// Default hardhat/anvil private key for testing
const MOCK_BUYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const buyerAccount = privateKeyToAccount(MOCK_BUYER_KEY)

const ENDPOINT = 'http://localhost:3000/api/agents/crypto-scanner'

async function runTest() {
  console.log('--------------------------------------------------')
  console.log('🤖 STARTING BUYER AGENT SIMULATION')
  console.log(`Buyer Wallet Address: ${buyerAccount.address}`)
  console.log(`Target Endpoint: ${ENDPOINT}`)
  console.log('--------------------------------------------------')

  // Step 1: Call endpoint without payment
  console.log('\n[Step 1] Sending initial request without payment header...')
  const payload = {
    token_address: '0x3600000000000000000000000000000000000000', // Mock USDC address
    chain: 'ethereum',
  }

  const res1 = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  console.log(`Response Status: ${res1.status} ${res1.statusText}`)

  if (res1.status !== 402) {
    console.error('❌ Expected status 402 Payment Required, got:', res1.status)
    process.exit(1)
  }

  const body1 = await res1.json()
  const challenge = body1.accepts?.[0]
  if (!challenge) {
    console.error('❌ Challenge not found in response accepts list')
    process.exit(1)
  }

  console.log('🟢 Received 402 Challenge details:')
  console.log(`  - Resource: ${challenge.resource}`)
  console.log(`  - Network: ${challenge.network}`)
  console.log(`  - Pay To: ${challenge.payTo}`)
  console.log(`  - Required Amount (wei): ${challenge.maxAmountRequired}`)
  console.log(`  - Asset (USDC Contract): ${challenge.asset}`)

  // Step 2: Sign EIP-3009 TransferWithAuthorization
  console.log('\n[Step 2] Signing EIP-3009 TransferWithAuthorization off-chain...')
  const chainId = parseInt(challenge.network.split(':')[1])
  
  const domain = {
    name: challenge.extra?.name ?? 'GatewayWalletBatched',
    version: challenge.extra?.version ?? '1',
    chainId,
    verifyingContract: (challenge.extra?.verifyingContract ?? challenge.asset) as `0x${string}`,
  }

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  }

  // Generate random 32-byte nonce hex
  const nonce = ('0x' + randomBytes(32).toString('hex')) as Hex
  const validAfter = 0n
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600) // valid for 1 hour

  const message = {
    from: buyerAccount.address,
    to: challenge.payTo as `0x${string}`,
    value: BigInt(challenge.maxAmountRequired),
    validAfter,
    validBefore,
    nonce,
  }

  const signature = await buyerAccount.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  })

  console.log('🟢 Created cryptographic signature:', signature.slice(0, 20) + '...')

  // Step 3: Package into X-PAYMENT header and retry
  console.log('\n[Step 3] Sending retried request with X-PAYMENT authorization...')
  
  const paymentHeaderPayload = {
    scheme: 'exact',
    network: challenge.network,
    payload: {
      authorization: {
        from: buyerAccount.address,
        to: challenge.payTo,
        value: challenge.maxAmountRequired,
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce,
        signature,
      },
    },
  }

  const xPayment = Buffer.from(JSON.stringify(paymentHeaderPayload)).toString('base64')

  const res2 = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': xPayment,
    },
    body: JSON.stringify(payload),
  })

  console.log(`Response Status: ${res2.status} ${res2.statusText}`)

  if (!res2.ok) {
    const errorText = await res2.text()
    console.error('❌ Verification failed on server:', errorText)
    process.exit(1)
  }

  const result = await res2.json()
  console.log('\n🎉 SUCCESS! Result returned from skill:')
  console.log(JSON.stringify(result, null, 2))
  console.log('\n--------------------------------------------------')
  console.log('✅ TEST COMPLETED SUCCESSFULLY')
  console.log('--------------------------------------------------')
}

runTest().catch((e) => {
  console.error('❌ Unhandled simulation error:', e)
  process.exit(1)
})
