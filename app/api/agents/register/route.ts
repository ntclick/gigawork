import { type NextRequest, NextResponse } from 'next/server'
import { createAgentWallet } from '@/lib/circle/wallet'
import { registerAgent } from '@/lib/arc/identity'
import { upsertAgent } from '@/lib/supabase/agents'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { name, description, capabilities, agentType, ownerAddress } = await req.json()

    if (!name || !agentType || !ownerAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: name, agentType, ownerAddress' },
        { status: 400 }
      )
    }

    if (agentType !== 'client' && agentType !== 'provider') {
      return NextResponse.json(
        { error: 'agentType must be either "client" or "provider"' },
        { status: 400 }
      )
    }

    // 1. Generate local EVM wallet (private key + address)
    const { walletId, walletAddress } = await createAgentWallet()

    // 2. Register agent on-chain (pins to IPFS, prefunds, registers ERC-8004 NFT)
    const { tokenId, txHash, metadataUri } = await registerAgent(walletId, walletAddress, {
      name,
      description: description ?? '',
      capabilities: capabilities ?? [],
      type: agentType,
    })

    // 3. Save agent to the database
    const agent = await upsertAgent({
      onchainId: BigInt(tokenId),
      ownerAddress: ownerAddress.toLowerCase(),
      agentType,
      name,
      description: description ?? '',
      capabilities: capabilities ?? [],
      walletId, // encrypted or raw private key
      walletAddress,
      metadataUri,
      reputationScore: '0',
      isActive: true,
    })

    // Return the response, converting BigInt fields to string/number
    return NextResponse.json({
      success: true,
      agent: {
        ...agent,
        onchainId: agent.onchainId?.toString(),
      },
      txHash,
    })
  } catch (err) {
    console.error('[api/agents/register] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
