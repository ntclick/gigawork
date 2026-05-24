import 'dotenv/config'

import { parseEntries } from '../lib/cosmic-raffle/parseEntries'
import { MerkleTree } from '../lib/cosmic-raffle/merkle'
import { fetchCosmicSeed } from '../lib/cosmic-raffle/fetchCosmicSeed'
import { getAdminWallet, publicClient, CONTRACT_ADDRESS, getWinningIndicesFromContract } from '../lib/cosmic-raffle/contract'
import CosmicRaffleArtifact from '../contracts/CosmicRaffle.json'
import { encodeFunctionData, keccak256, encodePacked, decodeEventLog } from 'viem'

async function main() {
  console.log('\n🏁 Starting End-to-End Cosmic Raffle Stateful Shared Contract Test...\n')
  console.log(`🏡 Shared Contract Address: ${CONTRACT_ADDRESS}`)

  if (!CONTRACT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_COSMIC_RAFFLE_ADDRESS is missing in environment variables.')
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

  // 3. Create Raffle campaign on-chain
  const wallet = getAdminWallet()
  const currentBlock = await publicClient.getBlockNumber()
  const commitBlock = Number(currentBlock) + 2
  const winnerCount = 2

  console.log(`📡 Sending createRaffle transaction to shared contract...`)
  console.log(`   - Total Entries: ${entries.length}`)
  console.log(`   - Winner Count: ${winnerCount}`)
  console.log(`   - Commit Block: ${commitBlock} (Current Block: ${currentBlock})`)

  const createCallData = encodeFunctionData({
    abi: CosmicRaffleArtifact.abi,
    functionName: 'createRaffle',
    args: [
      'E2E Shared Contract Raffle Campaign',
      root,
      BigInt(entries.length),
      BigInt(winnerCount),
      BigInt(commitBlock),
    ]
  })

  const createTx = await wallet.sendTransaction({
    account: wallet.account,
    to: CONTRACT_ADDRESS,
    data: createCallData,
  })

  console.log(`⏳ Waiting for createRaffle transaction receipt (tx: ${createTx})...`)
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTx })
  console.log(`✅ createRaffle confirmed in block ${createReceipt.blockNumber}!`)

  // Extract raffleId from event log
  let raffleId: number | null = null
  for (const log of createReceipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: CosmicRaffleArtifact.abi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'RaffleCreated' && decoded.args) {
        const args = decoded.args as any
        raffleId = Number(args.raffleId)
        break
      }
    } catch (e) {
      // skip
    }
  }

  if (raffleId === null) {
    throw new Error('❌ Failed to extract raffleId from createRaffle receipt logs.')
  }

  console.log(`🚀 Extracted Registered Raffle ID: ${raffleId}`)

  // 4. Wait for commit block to be mined
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

  // 5. Fetch Cosmic Seed via SpaceComputer SDK cTRNG
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
  console.log(`📡 Sending drawWinners transaction to shared contract...`)
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
  console.log(`✅ drawWinners successfully confirmed in block ${drawReceipt.blockNumber}!`)

  // 7. Verify winners on-chain
  console.log(`📥 Fetching winning indices from Shared Smart Contract...`)
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

  console.log(`🏁 End-to-End Stateful Shared Contract Integration Test completed successfully!`)
}

main().catch((e) => {
  console.error('\n❌ E2E Integration Test failed:', e)
  process.exit(1)
})
