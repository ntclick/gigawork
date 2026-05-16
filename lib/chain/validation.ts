/**
 * validation — ERC-8004 ValidationRegistry integration ("Agent Proofs").
 *
 * Reference: https://eips.ethereum.org/EIPS/eip-8004
 * Contract:  0x8004Cb1BF31DAf7788923b405b754f57acEB4272 (Arc Testnet)
 *
 * Two-step protocol per spec:
 *   1. `validationRequest(validator, agentId, requestURI, requestHash)` —
 *      called by the agent owner. Pins what is being validated and which
 *      validator should respond.
 *   2. `validationResponse(requestHash, response, responseURI, responseHash,
 *      tag)` — called by the validator with the verdict (0–100).
 *
 * In the GigaWork workflow lifecycle, each completed skill agent gets a
 * proof attestation after the ERC-8183 `complete()` tx. The admin wallet
 * acts as the validator for every skill the user's identity hasn't already
 * self-vouched for. If the admin owns the same agentId (self-dealing
 * scenario), we skip — same rule as reputation.ts.
 *
 * Best-effort: each failure is logged & swallowed so a settled workflow is
 * never blocked on a follow-up attestation. The trail UI surfaces the tx
 * hash when present, "pending" otherwise.
 */
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
  type Hex,
} from 'viem'

import {
  adminAccount,
  pollingClient,
  publicClient,
  sendAdminTransaction,
} from './client'

const VALIDATION_REGISTRY_ADDRESS = process.env
  .VALIDATION_REGISTRY_ADDRESS as `0x${string}` | undefined

const IDENTITY_REGISTRY_ADDRESS = (process.env.IDENTITY_REGISTRY_ADDRESS ??
  process.env.NEXT_PUBLIC_IDENTITY_REGISTRY) as `0x${string}` | undefined

const validationAbi = parseAbi([
  'function validationRequest(address validator, uint256 agentId, string requestURI, bytes32 requestHash) external',
  'function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag) external',
  'function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)',
])

const identityAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
])

// 100 = passed per ERC-8004 quickstart convention.
const RESPONSE_PASSED = 100
const VALIDATION_TAG = 'workflow_completed'

export interface ValidationResult {
  agentId: string
  requestTx: Hex | null
  responseTx: Hex | null
  requestHash: Hex
  passed: boolean
  skipped?: string  // reason if skipped (e.g. self-dealing, owner mismatch)
}

/**
 * Attest workflow completion for a single agentId. Performs the full
 * two-step flow with the admin wallet:
 *   - admin (as agent owner if it owns the token) → validationRequest
 *   - admin (as validator) → validationResponse
 *
 * The ERC-8004 contract requires `msg.sender == ownerOf(agentId)` for
 * the request step (typical for ownership-gated registries). When the
 * admin doesn't own the token, we can't request — skip with a reason.
 * In that case the actual owner (user) would need to request, which
 * we don't surface in this flow yet.
 */
async function attestOne(
  workflowId: string,
  agentId: string,
): Promise<ValidationResult> {
  const requestHash = keccak256(
    toHex(`gw-validation:${workflowId}:agent:${agentId}`),
  )
  const requestURI = '' // app-defined; left blank since we don't pin off-chain evidence yet

  const result: ValidationResult = {
    agentId,
    requestTx: null,
    responseTx: null,
    requestHash,
    passed: false,
  }

  if (!VALIDATION_REGISTRY_ADDRESS || !adminAccount) {
    result.skipped = 'validation_registry_not_configured'
    return result
  }

  const reviewer = getAddress(adminAccount.address).toLowerCase()

  // Confirm admin actually owns this agentId — required for the
  // ownership-gated `validationRequest`. If the user owns it, we skip.
  if (IDENTITY_REGISTRY_ADDRESS) {
    try {
      const owner = (await publicClient.readContract({
        address: IDENTITY_REGISTRY_ADDRESS,
        abi: identityAbi,
        functionName: 'ownerOf',
        args: [BigInt(agentId)],
      })) as `0x${string}`
      if (owner.toLowerCase() !== reviewer) {
        result.skipped = `owner_mismatch:${owner}`
        return result
      }
    } catch (err) {
      result.skipped = `ownerOf_failed:${err instanceof Error ? err.message : String(err)}`
      return result
    }
  }

  // ── Step 1: validationRequest (owner = admin) ────────────────────
  try {
    const data = encodeFunctionData({
      abi: validationAbi,
      functionName: 'validationRequest',
      args: [
        getAddress(adminAccount.address),
        BigInt(agentId),
        requestURI,
        requestHash,
      ],
    })
    const hash = await sendAdminTransaction({
      to: VALIDATION_REGISTRY_ADDRESS,
      data,
    })
    const receipt = await pollingClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 90_000,
      pollingInterval: 1_000,
    })
    if (receipt.status !== 'success') {
      result.skipped = `request_reverted:${hash}`
      return result
    }
    result.requestTx = hash
  } catch (err) {
    result.skipped = `request_failed:${err instanceof Error ? err.message : String(err)}`
    return result
  }

  // ── Step 2: validationResponse (validator = admin) ───────────────
  // responseHash mirrors requestHash so the indexer can join request ↔ response.
  const responseHash = requestHash
  try {
    const data = encodeFunctionData({
      abi: validationAbi,
      functionName: 'validationResponse',
      args: [
        requestHash,
        RESPONSE_PASSED,
        '', // responseURI
        responseHash,
        VALIDATION_TAG,
      ],
    })
    const hash = await sendAdminTransaction({
      to: VALIDATION_REGISTRY_ADDRESS,
      data,
    })
    const receipt = await pollingClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 90_000,
      pollingInterval: 1_000,
    })
    if (receipt.status !== 'success') {
      result.skipped = `response_reverted:${hash}`
      return result
    }
    result.responseTx = hash
    result.passed = true
  } catch (err) {
    result.skipped = `response_failed:${err instanceof Error ? err.message : String(err)}`
  }

  return result
}

/**
 * Attest a batch of agent tokenIds for a workflow. Calls happen
 * sequentially (sendAdminTransaction is nonce-serialized anyway) so each
 * tx broadcasts cleanly. Returns one ValidationResult per input id, in
 * order; callers persist these into the workflow trail.
 */
export async function attestWorkflowCompletion(
  workflowId: string,
  agentIds: string[],
): Promise<ValidationResult[]> {
  const unique = [...new Set(agentIds)]
  const results: ValidationResult[] = []
  for (const id of unique) {
    try {
      results.push(await attestOne(workflowId, id))
    } catch (err) {
      results.push({
        agentId: id,
        requestTx: null,
        responseTx: null,
        requestHash: '0x' as Hex,
        passed: false,
        skipped: `unexpected:${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  return results
}

/**
 * Read the latest validation status for a requestHash. Returns null when
 * the registry is unset or the call reverts (eg unknown requestHash).
 */
export async function getValidationStatus(requestHash: Hex): Promise<{
  validator: `0x${string}`
  agentId: string
  response: number
  tag: string
} | null> {
  if (!VALIDATION_REGISTRY_ADDRESS) return null
  try {
    const [validator, agentId, response, , tag] = (await publicClient.readContract(
      {
        address: VALIDATION_REGISTRY_ADDRESS,
        abi: validationAbi,
        functionName: 'getValidationStatus',
        args: [requestHash],
      },
    )) as readonly [`0x${string}`, bigint, number, `0x${string}`, string, bigint]
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
