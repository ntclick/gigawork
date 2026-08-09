import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { getAddress, parseAbi, parseEther, parseUnits, encodeFunctionData, type Hex } from 'viem'
import { adminAccount, publicClient, sendTransactionForAccount, sendAdminTransaction } from '@/lib/chain/client'
import { decryptSecret } from '@/lib/crypto/walletEncryption'

const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x3600000000000000000000000000000000000000') as `0x${string}`
const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')

const PREFUND_NATIVE_AMOUNT = process.env.PREFUND_NATIVE_AMOUNT ?? '0.01'
/** Exported so vault provisioning can mirror the real on-chain prefund
 *  amount into the off-chain spend ledger — see lib/payments/vault.ts. */
export const PREFUND_USDC_AMOUNT = process.env.PREFUND_USDC_AMOUNT ?? '0.3'

const erc20Abi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address a) view returns (uint256)',
])

export interface AgentWallet {
  walletId: string // Private key
  walletAddress: string // Public EVM address
}

/**
 * Creates a new developer-controlled EOA wallet locally.
 */
export async function createAgentWallet(): Promise<AgentWallet> {
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  return {
    walletId: privateKey,
    walletAddress: getAddress(account.address),
  }
}

/**
 * Obtains a viem Account instance from a walletId (private key).
 *
 * `walletId` may be an encrypted envelope (agents.wallet_id /
 * users.vault_wallet_id, post security-fix) or a legacy/raw plaintext hex
 * key (pre-migration rows, or an env-provided key like ADMIN_PRIVATE_KEY
 * passed in as a fallback) — decryptSecret() passes plaintext through
 * unchanged, so both cases work here without the caller needing to know
 * which one it has.
 */
export function getAgentAccount(walletId: string) {
  walletId = decryptSecret(walletId)
  if (!walletId.startsWith('0x')) {
    walletId = `0x${walletId}`
  }
  return privateKeyToAccount(walletId as Hex)
}

/**
 * Sends a transaction from an agent's wallet.
 */
export async function sendAgentTransaction(
  walletId: string,
  args: { to: `0x${string}`; data?: Hex; value?: bigint }
): Promise<Hex> {
  const account = getAgentAccount(walletId)
  return sendTransactionForAccount(account, args)
}

/**
 * Prefunds an agent's wallet with native gas and USDC from the admin account.
 */
export async function prefundAgentWallet(targetAddress: string): Promise<{
  nativeTx?: Hex
  usdcTx?: Hex
  error?: string
}> {
  if (!adminAccount) {
    console.warn('[prefundAgent] Admin account not configured. Skipping prefund.')
    return {}
  }

  const target = getAddress(targetAddress)
  const usdcAmount = parseUnits(PREFUND_USDC_AMOUNT, USDC_DECIMALS)
  const nativeAmount = parseEther(PREFUND_NATIVE_AMOUNT)

  let nativeTx: Hex | undefined
  try {
    const nativeBal = await publicClient.getBalance({ address: target })
    if (nativeBal < nativeAmount / BigInt(2)) {
      nativeTx = await sendAdminTransaction({ to: target, value: nativeAmount })
      await publicClient.waitForTransactionReceipt({ hash: nativeTx, confirmations: 1, timeout: 30_000 })
    }
  } catch (e) {
    console.warn('[prefundAgent] native tx failed', e)
    return { error: `native: ${e instanceof Error ? e.message : String(e)}` }
  }

  let usdcTx: Hex | undefined
  try {
    const usdcBal = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [target],
    })
    if (usdcBal < usdcAmount / BigInt(2)) {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [target, usdcAmount],
      })
      usdcTx = await sendAdminTransaction({ to: USDC_ADDRESS, data })
      await publicClient.waitForTransactionReceipt({ hash: usdcTx, confirmations: 1, timeout: 30_000 })
    }
  } catch (e) {
    console.warn('[prefundAgent] usdc tx failed', e)
    return { nativeTx, error: `usdc: ${e instanceof Error ? e.message : String(e)}` }
  }

  return { nativeTx, usdcTx }
}
