import { stringToHex, type Hex } from 'viem'

import { adminAccount, adminWallet } from './client'

/**
 * Records a workflow node dispatch on-chain by sending a 0-value self-tx
 * from the admin wallet, with the dispatch envelope encoded in the
 * `data` field. The transaction itself does not change state — its sole
 * purpose is to leave a verifiable trail (tx hash + calldata) that any
 * observer can decode to confirm an ERC-8183 pipeline step happened.
 *
 * v3 will replace this with a call to GigaWorkRegistry.recordJobDispatch
 * once the on-chain job book is wired up. For now this gives users a
 * clickable explorer link per skill dispatch.
 */
export type DispatchEnvelope = {
  workflowId: string
  nodeId: string
  skillName: string
  cost: number
  identityTokenId?: string | null
}

export async function signDispatchTx(env: DispatchEnvelope): Promise<{
  txHash: Hex
  calldata: Hex
} | null> {
  if (!adminWallet || !adminAccount) return null

  const payload = JSON.stringify({
    standard: 'ERC-8183',
    kind: 'pipeline.dispatch',
    workflow_id: env.workflowId,
    node_id: env.nodeId,
    skill: env.skillName,
    cost_credits: env.cost,
    identity_token_id: env.identityTokenId ?? null,
    ts: Math.floor(Date.now() / 1000),
  })

  // Truncate aggressively to keep gas predictable. 256 bytes is plenty
  // for a dispatch envelope.
  const truncated = payload.length > 256 ? payload.slice(0, 256) : payload
  const data = stringToHex(truncated) as Hex

  try {
    const txHash = await adminWallet.sendTransaction({
      to: adminAccount.address,
      value: BigInt(0),
      data,
    })
    return { txHash, calldata: data }
  } catch (e) {
    console.warn('[dispatch.signDispatchTx] failed', e instanceof Error ? e.message : e)
    return null
  }
}
