import { type NextRequest, NextResponse } from 'next/server'
import { getAgentById } from '@/lib/supabase/agents'
import { publicClient } from '@/lib/chain/client'
import { parseAbi, formatUnits } from 'viem'
import { USDC_CONTRACT } from '@/contracts/addresses'

export const dynamic = 'force-dynamic'

const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
])

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params

    const agent = await getAgentById(id)
    if (!agent || !agent.walletAddress) {
      return NextResponse.json({ error: 'Agent or wallet address not found' }, { status: 404 })
    }

    const wallet = agent.walletAddress as `0x${string}`

    // 1. Fetch native gas balance (e.g. ARC/ETH)
    const nativeBalanceRaw = await publicClient.getBalance({ address: wallet })
    const nativeBalance = formatUnits(nativeBalanceRaw, 18)

    // 2. Fetch USDC balance
    let usdcBalance = '0.00'
    try {
      const usdcBalanceRaw = await publicClient.readContract({
        address: USDC_CONTRACT as `0x${string}`,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [wallet],
      })
      usdcBalance = formatUnits(usdcBalanceRaw, 6)
    } catch (err) {
      console.warn(`[balance] Failed to fetch USDC balance for ${wallet}:`, err)
    }

    return NextResponse.json({
      walletAddress: wallet,
      usdc: usdcBalance,
      native: nativeBalance,
    })
  } catch (err) {
    console.error('[api/agents/[id]/balance] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
