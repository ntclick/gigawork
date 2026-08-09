/**
 * lib/payments/nanopaymentSettlement.ts
 *
 * Real on-chain x402 nanopayment settlement: every paid skill dispatch
 * moves REAL USDC on Arc Testnet from the user's own vault
 * (lib/payments/vault.ts) to the platform, one transaction per call —
 * per explicit product decision (accepted latency/gas tradeoff vs. an
 * off-chain-only ledger).
 *
 * Why not the existing x402/EIP-3009 middleware
 * (lib/chain/nanopayments.ts, app/api/agents/[id]/route.ts)?
 * That path signs against a "GatewayWalletBatched" contract
 * (0x0077777d7EBA4688BDeF3E311b846F25870A19B9) that has only ~160 bytes
 * of bytecode on Arc Testnet — not a functional settlement contract —
 * and its `queueAuthorizationForSettlement` only ever pushes to an
 * in-memory array; nothing drains that queue to chain. Wiring skill
 * dispatch through it would produce signatures that LOOK real but never
 * settle. Left in place, dormant, documented, for future genuine
 * external HTTP agents — see the deprecation-style note there. This
 * module instead does a plain, direct, verifiable ERC-20 transfer from
 * the vault, reusing the exact same tx-sending infrastructure already
 * proven working for ERC-8183 escrow (lib/chain/client.ts
 * sendTransactionForAccount).
 */
import { encodeFunctionData, parseUnits, type Hex } from 'viem'

import { adminAccount, publicClient, sendTransactionForAccount } from '@/lib/chain/client'
import { prefundAgentWallet } from '@/lib/circle/wallet'
import { getUserVaultAccount } from '@/lib/payments/vault'

const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`
const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')

const erc20Abi = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

export class NanopaymentSettlementError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'NanopaymentSettlementError'
  }
}

/**
 * Settles one skill-call payment on-chain: userId's vault → platform
 * treasury (the admin address — same recipient ERC-8183 provider/
 * evaluator already use). Throws NanopaymentSettlementError on any
 * failure (insufficient funds, gas, revert, timeout) — callers must
 * treat that as the node failing, not proceed to run the skill, and
 * roll back any off-chain ledger pre-charge.
 */
export async function settleSkillPaymentOnChain(opts: {
  userId: string
  amountUsdc: number
}): Promise<{ txHash: Hex }> {
  if (!adminAccount) {
    throw new NanopaymentSettlementError('admin wallet not configured (ADMIN_PRIVATE_KEY missing) — cannot settle nanopayments')
  }
  if (opts.amountUsdc <= 0) {
    throw new NanopaymentSettlementError('amountUsdc must be positive')
  }

  const vault = await getUserVaultAccount(opts.userId)
  const amountWei = parseUnits(opts.amountUsdc.toFixed(6), USDC_DECIMALS)

  try {
    // Cheap gas pre-flight — a vault that's made many prior on-chain
    // payments this workflow can run dry. Best-effort top-up so a
    // mid-workflow node doesn't hard-fail on gas alone.
    const nativeBal = await publicClient.getBalance({ address: vault.address })
    if (nativeBal === 0n) {
      await prefundAgentWallet(vault.address).catch(() => {})
    }

    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [adminAccount.address, amountWei],
    })

    const hash = await sendTransactionForAccount(vault, { to: USDC_ADDRESS, data })
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 45_000,
    })
    if (receipt.status !== 'success') {
      throw new NanopaymentSettlementError(`nanopayment tx ${hash} reverted`)
    }
    return { txHash: hash }
  } catch (e) {
    if (e instanceof NanopaymentSettlementError) throw e
    throw new NanopaymentSettlementError(
      `nanopayment settlement failed: ${e instanceof Error ? e.message : String(e)}`,
      e,
    )
  }
}
