import { randomBytes } from 'crypto'
import { toHex, parseUnits, verifyTypedData, encodeFunctionData, type Hex } from 'viem'
import { getAgentAccount, sendAgentTransaction } from './wallet'
import { USDC_CONTRACT } from '@/contracts/addresses'
import { publicClient } from '@/lib/chain/client'

const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '5042002')

export const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2', // typical USDC version is 2 on EVM, or we can follow standard
  chainId: CHAIN_ID,
  verifyingContract: USDC_CONTRACT as `0x${string}`,
} as const

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

export interface EIP3009Authorization {
  from: string
  to: string
  value: string       // uint256 in base units (wei/usdc)
  validAfter: string  // unix timestamp
  validBefore: string // unix timestamp
  nonce: string       // bytes32 hex
  signature: string   // signature hex
}

const erc20Abi = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

/**
 * Signs an EIP-3009 TransferWithAuthorization using the buyer agent's private key.
 */
export async function signEIP3009Payment(
  fromPrivateKey: string,
  toAddress: string,
  amountUsdc: string
): Promise<EIP3009Authorization> {
  const account = getAgentAccount(fromPrivateKey)
  const fromAddress = account.address
  const value = parseUnits(amountUsdc, USDC_DECIMALS).toString()
  const nonce = toHex(randomBytes(32))

  const now = Math.floor(Date.now() / 1000)
  const validAfter = '0'
  const validBefore = (now + 3600 * 24).toString() // valid for 24 hours

  const message = {
    from: fromAddress,
    to: toAddress as `0x${string}`,
    value: BigInt(value),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce: nonce as Hex,
  }

  const signature = await account.signTypedData({
    domain: USDC_DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  })

  return {
    from: fromAddress,
    to: toAddress,
    value,
    validAfter,
    validBefore,
    nonce,
    signature,
  }
}

/**
 * Cryptographically verifies an EIP-3009 signature.
 */
export async function verifyEIP3009Payment(
  auth: EIP3009Authorization,
  expectedToAddress?: string
): Promise<string> {
  const message = {
    from: auth.from as `0x${string}`,
    to: auth.to as `0x${string}`,
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce as Hex,
  }

  const now = BigInt(Math.floor(Date.now() / 1000))
  if (now < message.validAfter) {
    throw new Error('Payment authorization not yet valid')
  }
  if (now > message.validBefore) {
    throw new Error('Payment authorization expired')
  }

  if (expectedToAddress && auth.to.toLowerCase() !== expectedToAddress.toLowerCase()) {
    throw new Error(`Recipient mismatch: expected ${expectedToAddress}, got ${auth.to}`)
  }

  const valid = await verifyTypedData({
    address: auth.from as `0x${string}`,
    domain: USDC_DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
    signature: auth.signature as Hex,
  })

  if (!valid) {
    throw new Error('Invalid EIP-3009 authorization signature')
  }

  return auth.from
}

/**
 * Settles the payment on-chain on Arc Testnet by calling transfer on the USDC contract.
 */
export async function settleNanopayment(
  buyerPrivateKey: string,
  auth: EIP3009Authorization
): Promise<Hex> {
  // Verify first
  await verifyEIP3009Payment(auth)

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [auth.to as `0x${string}`, BigInt(auth.value)],
  })

  const txHash = await sendAgentTransaction(buyerPrivateKey, {
    to: USDC_CONTRACT as `0x${string}`,
    data,
  })

  // Wait for settlement receipt
  await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 30_000,
  })

  return txHash
}
