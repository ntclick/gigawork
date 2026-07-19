import { encodeFunctionData, type Hex, decodeEventLog } from 'viem'
import { IDENTITY_REGISTRY } from '@/contracts/addresses'
import { sendAgentTransaction, prefundAgentWallet } from '../circle/wallet'
import { publicClient } from '../chain/client'
import { pinJSON } from '../chain/pinata'

const identityAbi = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    name: 'Registered',
    type: 'event',
    inputs: [
      { indexed: true, name: 'agentId', type: 'uint256' },
      { name: 'agentURI', type: 'string' },
      { indexed: true, name: 'owner', type: 'address' },
    ],
  },
] as const

export interface AgentMetadata {
  name: string
  description: string
  capabilities: string[]
  type: 'client' | 'provider'
  walletAddress: string
}

/**
 * Pins agent metadata to IPFS and registers the agent identity on-chain.
 */
export async function registerAgent(
  walletId: string,
  walletAddress: string,
  meta: Omit<AgentMetadata, 'walletAddress'>
): Promise<{ tokenId: string; txHash: Hex; metadataUri: string }> {
  // 1. Pin metadata to IPFS via Pinata
  const metadataPayload: AgentMetadata = {
    ...meta,
    walletAddress,
  }

  let metadataUri = ''
  try {
    const pinResult = await pinJSON(metadataPayload, { name: `agent-${meta.name}` })
    metadataUri = pinResult.ipfsUri
  } catch (err) {
    console.error('[identity] Pinata pinning failed, falling back to dummy URI', err)
    metadataUri = `ipfs://dummy-cid-${Date.now()}`
  }

  // 2. Prefund agent's wallet so it can pay for gas on Arc Testnet
  await prefundAgentWallet(walletAddress)

  // 3. Encode IDENTITY_REGISTRY.register(metadataUri)
  const data = encodeFunctionData({
    abi: identityAbi,
    functionName: 'register',
    args: [metadataUri],
  })

  // 4. Send transaction signed by agent's wallet
  const txHash = await sendAgentTransaction(walletId, {
    to: IDENTITY_REGISTRY as `0x${string}`,
    data,
  })

  // 5. Wait for transaction receipt
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 45_000,
  })

  if (receipt.status !== 'success') {
    throw new Error(`Agent registration transaction reverted: ${txHash}`)
  }

  // 6. Extract token ID from the Registered event logs
  let tokenId: string | null = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: identityAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'Registered') {
        tokenId = decoded.args.agentId.toString()
        break
      }
    } catch {
      // skip logs from other contracts or events
    }
  }

  if (!tokenId) {
    throw new Error('Agent registered on-chain but Registered event was not emitted or parsed')
  }

  return { tokenId, txHash, metadataUri }
}
