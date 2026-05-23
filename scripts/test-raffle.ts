import 'dotenv/config'

import { parseEntries } from '../lib/cosmic-raffle/parseEntries'
import { MerkleTree } from '../lib/cosmic-raffle/merkle'
import { fetchCosmicSeed } from '../lib/cosmic-raffle/fetchCosmicSeed'
import { getAdminWallet, publicClient, CONTRACT_ADDRESS, getWinningIndicesFromContract } from '../lib/cosmic-raffle/contract'
import CosmicRaffleArtifact from '../contracts/CosmicRaffle.json'
import { encodeFunctionData, keccak256, encodePacked } from 'viem'

async function main() {
  console.log('\n🏁 Starting End-to-End Cosmic Raffle Integration Test...\n')
  console.log(`🏡 Contract Address: ${CONTRACT_ADDRESS}`)

  if (!CONTRACT_ADDRESS) {
    throw new Error('COSMIC_RAFFLE_ADDRESS / NEXT_PUBLIC_COSMIC_RAFFLE_ADDRESS is missing in environment variables.')
  }

  // 1. Prepare raw input list
  const rawInput = `
    Alice
    Bob
    Charlie
    Dave
    Eve
  `
  const entries = parseEntries(rawInput)
  console.log(`👤 Parsed unique contestants:`, entries)

  // 2. Build Merkle Tree
  const tree = new MerkleTree(entries)
  const root = tree.getRoot()
  console.log(`🌳 Merkle Root computed: ${root}`)

  // 3. Create raffle on-chain
  const wallet = getAdminWallet()
  const currentBlock = await publicClient.getBlockNumber()
  // Set commitBlock to currentBlock + 2 for fast testing
  const commitBlock = Number(currentBlock) + 2
  const winnerCount = 2

  console.log(`📡 Creating raffle on-chain...`)
  console.log(`   - Title: E2E Test Raffle`)
  console.log(`   - Total Entries: ${entries.length}`)
  console.log(`   - Winner Count: ${winnerCount}`)
  console.log(`   - Commit Block: ${commitBlock} (Current Block: ${currentBlock})`)

  const callData = encodeFunctionData({
    abi: CosmicRaffleArtifact.abi,
    functionName: 'createRaffle',
    args: [
      'E2E Test Raffle',
      root,
      BigInt(entries.length),
      BigInt(winnerCount),
      BigInt(commitBlock)
    ]
  })

  const txHash = await wallet.sendTransaction({
    account: wallet.account,
    to: CONTRACT_ADDRESS,
    data: callData,
  })

  console.log(`⏳ Waiting for createRaffle transaction receipt (tx: ${txHash})...`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  console.log(`✅ Raffle transaction confirmed in block ${receipt.blockNumber}!`)

  const count = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: CosmicRaffleArtifact.abi,
    functionName: 'getRaffleCount',
  }) as bigint
  const raffleId = Number(count) - 1
  console.log(`🆔 Resolved On-Chain Raffle ID: ${raffleId}`)

  // 4. Wait for commit block
  console.log(`⏳ Waiting for block ${commitBlock} to be mined...`)
  while (true) {
    const blockNum = await publicClient.getBlockNumber()
    if (blockNum >= BigInt(commitBlock)) {
      console.log(`✅ Target block ${commitBlock} reached (Current Block: ${blockNum})!`)
      break
    }
    console.log(`   - Still at block ${blockNum}, waiting 2 seconds...`)
    await new Promise((r) => setTimeout(r, 2000))
  }

  // 5. Fetch Cosmic Seed
  console.log(`🛰️ Fetching Cosmic Seed from SpaceComputer cTRNG setup...`)
  const seed = await fetchCosmicSeed(commitBlock)
  console.log(`🔮 Derived Verifiable Cosmic Seed: ${seed}`)

  // Pre-calculate winning indices off-chain using the seed
  const winningIndicesArray: number[] = []
  const totalEntries = entries.length
 
  // Replicate on-chain Fisher-Yates draw logic
  const tempSwaps = new Map<number, number>()
  for (let i = 0; i < winnerCount; i++) {
    const randHex = keccak256(encodePacked(['bytes32', 'uint256'], [seed, BigInt(i)]))
    const rand = BigInt(randHex)
    const j = i + Number(rand % BigInt(totalEntries - i))
 
    const valJ = tempSwaps.get(j) ?? j
    const valI = tempSwaps.get(i) ?? i
 
    tempSwaps.set(i, valJ)
    tempSwaps.set(j, valI)
 
    winningIndicesArray.push(valJ)
  }
 
  const winningUsernames = winningIndicesArray.map(idx => entries[idx])
  const proofs = winningIndicesArray.map(idx => tree.getProof(idx))

  // 6. Draw winners on-chain
  console.log(`📡 Sending drawWinners transaction to blockchain...`)
  const drawData = encodeFunctionData({
    abi: CosmicRaffleArtifact.abi,
    functionName: 'drawWinners',
    args: [
      BigInt(raffleId),
      seed,
      winningUsernames,
      proofs
    ]
  })

  const drawTx = await wallet.sendTransaction({
    account: wallet.account,
    to: CONTRACT_ADDRESS,
    data: drawData,
  })

  console.log(`⏳ Waiting for drawWinners confirmation receipt (tx: ${drawTx})...`)
  const drawReceipt = await publicClient.waitForTransactionReceipt({ hash: drawTx })
  console.log(`✅ On-chain draw successfully confirmed in block ${drawReceipt.blockNumber}!`)

  // 7. Verify winners
  console.log(`📥 Fetching winning indices from Smart Contract...`)
  const winningIndices = await getWinningIndicesFromContract(raffleId)
  console.log(`🏆 Winning indices drawn by contract:`, winningIndices)

  console.log(`\n🎉 --- VERIFIABLE DRAW RESULTS ---`)
  winningIndices.forEach((index, idx) => {
    const username = entries[index]
    const proof = tree.getProof(index)
    const valid = MerkleTree.verify(username, proof, root)
    console.log(`Winner #${idx + 1}: "${username}" (Ticket Index #${index})`)
    console.log(`  - Cryptographic Merkle Sibling Path: [${proof.map(p => `${p.slice(0, 10)}...`).join(', ')}]`)
    console.log(`  - Cryptographic Proof Valid: ${valid ? "✅ YES" : "❌ NO"}`)
  })
  console.log(`------------------------------------\n`)

  console.log(`🏁 End-to-End Cosmic Raffle Integration Test completed successfully!`)
}

main().catch((e) => {
  console.error('\n❌ E2E Integration Test failed:', e)
  process.exit(1)
})
