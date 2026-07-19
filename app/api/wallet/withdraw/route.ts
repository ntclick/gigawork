import { type NextRequest, NextResponse } from 'next/server'
import { getAgentById } from '@/lib/supabase/agents'
import { sendAgentTransaction } from '@/lib/circle/wallet'
import { USDC_CONTRACT } from '@/contracts/addresses'
import { parseUnits, encodeFunctionData, type Hex } from 'viem'
import { publicClient } from '@/lib/chain/client'
import { getCurrentUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

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

const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? '6')

export async function POST(req: NextRequest) {
  try {
    const { agentId, toAddress, amountUsdc } = await req.json()

    if (!agentId || !toAddress || !amountUsdc) {
      return NextResponse.json(
        { error: 'Missing required fields: agentId, toAddress, amountUsdc' },
        { status: 400 }
      )
    }

    const user = await getCurrentUser().catch(() => null)
    if (!user || !user.wallet) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }

    const agent = await getAgentById(agentId)
    if (!agent || !agent.walletId || !agent.walletAddress) {
      return NextResponse.json({ error: 'Agent wallet is not configured' }, { status: 404 })
    }

    if (agent.ownerAddress.toLowerCase() !== user.wallet.toLowerCase()) {
      return NextResponse.json({ error: 'forbidden: you do not own this agent' }, { status: 403 })
    }

    const amount = parseUnits(amountUsdc.toString(), USDC_DECIMALS)

    // Encode USDC transfer calldata
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [toAddress as `0x${string}`, amount],
    })

    // Broadcast the transaction from the agent's wallet
    const txHash = await sendAgentTransaction(agent.walletId, {
      to: USDC_CONTRACT as `0x${string}`,
      data,
    })

    // Wait for the transaction confirmation
    await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
      timeout: 30_000,
    })

    return NextResponse.json({
      success: true,
      txHash,
    })
  } catch (err) {
    console.error('[api/wallet/withdraw] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
