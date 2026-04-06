'use client'

import { useQuery } from '@tanstack/react-query'
import { ethers } from 'ethers'
import { api } from '@/lib/api'

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC || 'https://rpc.testnet.arc.network'
const USDC = process.env.NEXT_PUBLIC_USDC_ADDRESS || '0x3600000000000000000000000000000000000000'

async function fetchOnChainBalance(address: string): Promise<number> {
  try {
    // Arc USDC is ERC-20 at 0x3600... with 6 decimals
    const provider = new ethers.JsonRpcProvider(ARC_RPC)
    const usdc = new ethers.Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider)
    const bal = await usdc.balanceOf(address)
    return parseFloat(ethers.formatUnits(bal, 6))
  } catch {
    return 0
  }
}

export function useBalance(address?: string) {
  // On-chain USDC balance
  const { data: onChain, refetch: refetchOnChain } = useQuery({
    queryKey: ['onchain-balance', address],
    queryFn: () => address ? fetchOnChainBalance(address) : 0,
    enabled: !!address,
    refetchInterval: 30000,
  })

  // Platform balance (DB)
  const { data: platform, refetch: refetchPlatform } = useQuery({
    queryKey: ['platform-balance', address],
    queryFn: () => address ? api.balance.get(address).then((d: any) => d.balance || 0).catch(() => 0) : 0,
    enabled: !!address,
    refetchInterval: 30000,
  })

  return {
    onChainBalance: onChain || 0,
    platformBalance: platform || 0,
    balance: (onChain || 0) + (platform || 0), // total
    refetch: () => { refetchOnChain(); refetchPlatform() },
  }
}
