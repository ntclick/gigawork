import { createPublicClient, createWalletClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import CosmicRaffleArtifact from '../../contracts/CosmicRaffle.json'
import CosmicRaffleInstanceArtifact from '../../contracts/CosmicRaffleInstance.json'

// ─── Setup Chain & Clients ─────────────────────────────────────
const ARC_RPC = process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC ?? 'https://rpc.testnet.arc.network'
export const CONTRACT_ADDRESS = (process.env.COSMIC_RAFFLE_ADDRESS ?? process.env.NEXT_PUBLIC_COSMIC_RAFFLE_ADDRESS ?? '0x3ea7ed77795acad23e414daea25af690810d6dbb') as `0x${string}`
export const FACTORY_ADDRESS = (process.env.NEXT_PUBLIC_COSMIC_RAFFLE_FACTORY_ADDRESS ?? '0x972c84ede4e2f1d9cd9cb1181b99a5e0643f2d39') as `0x${string}`

export const arcChain = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '5042002'),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
})

export const publicClient = createPublicClient({
  chain: arcChain,
  transport: http(ARC_RPC),
})

/**
 * Returns a wallet client initialized with the admin operator private key.
 */
export function getAdminWallet() {
  const pk = process.env.ADMIN_PRIVATE_KEY
  if (!pk) {
    throw new Error('ADMIN_PRIVATE_KEY is missing from environment variables.')
  }
  const account = privateKeyToAccount(pk as `0x${string}`)
  return createWalletClient({
    account,
    chain: arcChain,
    transport: http(ARC_RPC),
  })
}

/**
 * Reads the list of winning indices directly from the standalone raffle contract instance by address.
 */
export async function getWinningIndicesFromStandaloneContract(contractAddress: `0x${string}`): Promise<number[]> {
  try {
    const data = await publicClient.readContract({
      address: contractAddress,
      abi: CosmicRaffleInstanceArtifact.abi,
      functionName: 'getWinningIndices',
    }) as bigint[]

    return data.map(Number)
  } catch (error) {
    console.error(`❌ getWinningIndices failed for standalone contract ${contractAddress}:`, error)
    throw error
  }
}

/**
 * Reads the list of winning indices directly from the smart contract.
 */
export async function getWinningIndicesFromContract(raffleId: number): Promise<number[]> {
  if (!CONTRACT_ADDRESS) {
    throw new Error('COSMIC_RAFFLE_ADDRESS / NEXT_PUBLIC_COSMIC_RAFFLE_ADDRESS is not defined.')
  }

  try {
    const data = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: CosmicRaffleArtifact.abi,
      functionName: 'getWinningIndices',
      args: [BigInt(raffleId)],
    }) as bigint[]

    return data.map(Number)
  } catch (error) {
    console.error(`❌ getWinningIndices failed for raffleId ${raffleId}:`, error)
    throw error
  }
}

/**
 * Executes the drawWinners transaction on-chain signed by the admin operator key.
 * Resolves once the transaction has been successfully mined in a block receipt.
 */
export async function drawWinnersOnChain(raffleId: number, seed: `0x${string}`): Promise<`0x${string}`> {
  if (!CONTRACT_ADDRESS) {
    throw new Error('COSMIC_RAFFLE_ADDRESS / NEXT_PUBLIC_COSMIC_RAFFLE_ADDRESS is not defined.')
  }

  const wallet = getAdminWallet()
  const account = wallet.account

  try {
    console.log(`📡 Simulating drawWinners for raffleId: ${raffleId}, seed: ${seed}...`)
    const { request } = await publicClient.simulateContract({
      account,
      address: CONTRACT_ADDRESS,
      abi: CosmicRaffleArtifact.abi,
      functionName: 'drawWinners',
      args: [BigInt(raffleId), seed],
    })

    console.log(`✍️ Broadcasting drawWinners transaction...`)
    const hash = await wallet.writeContract(request)

    console.log(`⏳ Waiting for drawWinners confirmation (tx: ${hash})...`)
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 120_000,
    })

    if (receipt.status !== 'success') {
      throw new Error(`Transaction reverted: ${hash}`)
    }

    console.log(`✅ On-chain draw successfully confirmed in block ${receipt.blockNumber}`)
    return hash
  } catch (error) {
    console.error(`❌ drawWinnersOnChain failed:`, error)
    throw error
  }
}
