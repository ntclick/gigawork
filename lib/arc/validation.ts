import { encodeFunctionData, keccak256, parseAbi, toHex, type Hex } from 'viem'
import { VALIDATION_REGISTRY } from '@/contracts/addresses'
import { publicClient, sendAdminTransaction, adminAccount } from '../chain/client'
import { sendAgentTransaction } from '../circle/wallet'

const validationAbi = parseAbi([
  'function validationRequest(address validator, uint256 agentId, string requestURI, bytes32 requestHash) external',
  'function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag) external',
  'function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)',
])

const RESPONSE_PASSED = 100

/**
 * Sends a validation request from the agent's own wallet.
 */
export async function submitValidationRequest(
  agentPrivateKey: string,
  agentTokenId: string,
  validatorAddress: string,
  requestHash: Hex
): Promise<Hex | null> {
  if (!VALIDATION_REGISTRY) return null

  const data = encodeFunctionData({
    abi: validationAbi,
    functionName: 'validationRequest',
    args: [
      validatorAddress as `0x${string}`,
      BigInt(agentTokenId),
      '', // requestURI
      requestHash,
    ],
  })

  try {
    const hash = await sendAgentTransaction(agentPrivateKey, {
      to: VALIDATION_REGISTRY as `0x${string}`,
      data,
    })

    await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 30_000,
    })

    return hash
  } catch (err) {
    console.error(`[validation] Request failed for agent ${agentTokenId}:`, err)
    return null
  }
}

/**
 * Responds to a validation request using the platform admin/validator account.
 */
export async function submitValidationResponse(
  requestHash: Hex,
  tag: string = 'job_completed'
): Promise<Hex | null> {
  if (!VALIDATION_REGISTRY || !adminAccount) return null

  const data = encodeFunctionData({
    abi: validationAbi,
    functionName: 'validationResponse',
    args: [
      requestHash,
      RESPONSE_PASSED,
      '', // responseURI
      requestHash, // responseHash (mirrors requestHash)
      tag,
    ],
  })

  try {
    const hash = await sendAdminTransaction({
      to: VALIDATION_REGISTRY as `0x${string}`,
      data,
    })

    await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 30_000,
    })

    return hash
  } catch (err) {
    console.error(`[validation] Response failed for hash ${requestHash}:`, err)
    return null
  }
}

/**
 * Reads the latest validation status from the contract.
 */
export async function getValidationStatus(requestHash: Hex): Promise<{
  validator: `0x${string}`
  agentId: string
  response: number
  tag: string
} | null> {
  if (!VALIDATION_REGISTRY) return null
  try {
    const [validator, agentId, response, , tag] = (await publicClient.readContract({
      address: VALIDATION_REGISTRY as `0x${string}`,
      abi: validationAbi,
      functionName: 'getValidationStatus',
      args: [requestHash],
    })) as readonly [`0x${string}`, bigint, number, `0x${string}`, string, bigint]

    return {
      validator,
      agentId: agentId.toString(),
      response,
      tag,
    }
  } catch {
    return null
  }
}
