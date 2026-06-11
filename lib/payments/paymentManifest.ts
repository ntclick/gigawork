import { privateKeyToAccount } from 'viem/accounts'
import { randomBytes } from 'crypto'
import { type Hex } from 'viem'
import { getEndpointConfig } from '@/lib/nanopayments/config'

// Derive the buyer account from ADMIN_PRIVATE_KEY
const adminKey = process.env.ADMIN_PRIVATE_KEY
const buyerAccount = adminKey ? privateKeyToAccount(adminKey as Hex) : null

export interface EIP3009Authorization {
  from: string
  to: string
  value: string       // uint256 in wei
  validAfter: string  // uint256 unix timestamp
  validBefore: string // uint256 unix timestamp
  nonce: string       // bytes32 hex
  signature: string   // hex signature from buyer wallet
}

export interface PaymentManifestItem {
  workflowId: string
  nodeId: string
  skillName: string
  resource: string
  amountUsdc: string
  paymentHeader?: string
}

/**
 * Generates an EIP-3009 TransferWithAuthorization payload for the given skill based on configuration.
 */
export async function createPaymentHeader(args: {
  skillName: string
  workflowId: string
  nodeId: string
}): Promise<string | null> {
  if (!buyerAccount) {
    console.warn('[paymentManifest] ADMIN_PRIVATE_KEY not configured. Cannot sign x402 payments.')
    return null
  }

  const config = getEndpointConfig(args.skillName)
  if (!config || !config.enabled || parseFloat(config.priceUsdc) <= 0) {
    return null
  }

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '5042002')
  const sellerAddress = (process.env.ADMIN_WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
  const gatewayWalletAddress = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as `0x${string}`

  // Convert human-readable USDC price to wei (6 decimals)
  const amountWei = String(BigInt(Math.round(parseFloat(config.priceUsdc) * 10 ** 6)))

  const domain = {
    name: 'GatewayWalletBatched',
    version: '1',
    chainId,
    verifyingContract: gatewayWalletAddress,
  }

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  }

  const nonce = ('0x' + randomBytes(32).toString('hex')) as Hex
  const validAfter = 0n
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600) // valid for 1 hour

  const message = {
    from: buyerAccount.address,
    to: sellerAddress,
    value: BigInt(amountWei),
    validAfter,
    validBefore,
    nonce,
  }

  const signature = await buyerAccount.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  })

  const paymentHeaderPayload = {
    scheme: 'exact',
    network: `eip155:${chainId}`,
    workflowId: args.workflowId,
    nodeId: args.nodeId,
    payload: {
      authorization: {
        from: buyerAccount.address,
        to: sellerAddress,
        value: amountWei,
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce,
        signature,
      },
    },
  }

  return Buffer.from(JSON.stringify(paymentHeaderPayload)).toString('base64')
}

/**
 * Generates an EIP-3009 TransferWithAuthorization payload from an HTTP 402 challenge description.
 */
export async function createPaymentHeaderFromChallenge(args: {
  challenge: {
    network: string
    payTo: string
    maxAmountRequired: string
    asset: string
    extra?: {
      name?: string
      version?: string
      verifyingContract?: string
    }
  }
  skillName: string
}): Promise<string | null> {
  if (!buyerAccount) {
    return null
  }

  const { challenge } = args
  const chainId = parseInt(challenge.network.split(':')[1])

  const domain = {
    name: challenge.extra?.name ?? 'GatewayWalletBatched',
    version: challenge.extra?.version ?? '1',
    chainId,
    verifyingContract: (challenge.extra?.verifyingContract ?? challenge.asset) as `0x${string}`,
  }

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  }

  const nonce = ('0x' + randomBytes(32).toString('hex')) as Hex
  const validAfter = 0n
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600) // valid for 1 hour

  const message = {
    from: buyerAccount.address,
    to: challenge.payTo as `0x${string}`,
    value: BigInt(challenge.maxAmountRequired),
    validAfter,
    validBefore,
    nonce,
  }

  const signature = await buyerAccount.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  })

  const paymentHeaderPayload = {
    scheme: 'exact',
    network: challenge.network,
    payload: {
      authorization: {
        from: buyerAccount.address,
        to: challenge.payTo,
        value: challenge.maxAmountRequired,
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce,
        signature,
      },
    },
  }

  return Buffer.from(JSON.stringify(paymentHeaderPayload)).toString('base64')
}
