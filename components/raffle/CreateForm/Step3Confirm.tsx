'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, ArrowLeft } from 'lucide-react'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { usePrivy } from '@privy-io/react-auth'
import { Button } from '@/components/ui/button'
import { createPublicClient, http } from 'viem'
import { arcTestnet } from '@/lib/chain/arcTestnet'
import { MerkleTree } from '@/lib/cosmic-raffle/merkle'
import CosmicRaffleArtifact from '@/contracts/CosmicRaffle.json'

interface Step3Props {
  infoData: {
    title: string
    description: string
    prizeDescription: string
    winnerCount: number
  }
  listData: {
    rawInput: string
    entries: string[]
    merkleRoot: string
    commitBlock: number
    totalEntries: number
  }
  onPrev: () => void
}

const COSMIC_RAFFLE_ADDRESS = (process.env.NEXT_PUBLIC_COSMIC_RAFFLE_ADDRESS || '0x46c6c3e07a96227a9834cfc60a387bc96c66872a') as `0x${string}`

export function Step3Confirm({ infoData, listData, onPrev }: Step3Props) {
  const activeWallet = useActiveWallet()
  const { user: privyUser } = usePrivy()
  const router = useRouter()

  const [loading, setLoading] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState('')
  const [estimatedFee, setEstimatedFee] = useState<string>('')

  useEffect(() => {
    async function estimateGas() {
      if (!activeWallet) return
      try {
        const publicClient = createPublicClient({
          chain: arcTestnet,
          transport: http(process.env.NEXT_PUBLIC_ARC_RPC || 'https://rpc.testnet.arc.network'),
        })

        // Reconstruct Merkle Tree to get proofs for gas estimation simulation
        const mockSeed = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`
        const winnerCount = infoData.winnerCount
        const entries = listData.entries
        const tree = new MerkleTree(entries)
        
        // Take the first N entries as mock winners
        const mockWinners = entries.slice(0, winnerCount)
        const mockProofs = mockWinners.map((_, idx) => tree.getProof(idx))

        const gas = await publicClient.estimateContractGas({
          address: COSMIC_RAFFLE_ADDRESS,
          abi: CosmicRaffleArtifact.abi,
          functionName: 'drawRaffle',
          account: activeWallet.address as `0x${string}`,
          args: [
            listData.merkleRoot,
            BigInt(listData.totalEntries),
            BigInt(infoData.winnerCount),
            BigInt(listData.commitBlock),
            mockSeed,
            mockWinners,
            mockProofs,
          ],
        })

        const gasPrice = await publicClient.getGasPrice()
        const totalFee = gas * gasPrice
        setEstimatedFee((Number(totalFee) / 1e18).toFixed(6))
      } catch (err) {
        console.warn('Gas estimation failed:', err)
        setEstimatedFee('0.000350') // fallback
      }
    }
    estimateGas()
  }, [activeWallet, infoData, listData])

  const handleCreate = async () => {
    setError('')
    setLoading(true)

    const wallet = activeWallet
    if (!wallet) {
      setError('Please connect your wallet to continue.')
      setLoading(false)
      return
    }

    try {
      // 1. Pre-sync server-side session cookie to match Privy's active wallet
      setStatusText('Synchronizing session...')
      await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: wallet.address.toLowerCase(),
          ...(privyUser?.id ? { privyId: privyUser.id } : {}),
        }),
      })

      // 2. Store finalized raffle record in database cache (100% off-chain creation!)
      setStatusText('Registering raffle campaign...')
      const res = await fetch('/api/raffles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: infoData.title,
          description: infoData.description,
          prizeDescription: infoData.prizeDescription,
          winnerCount: infoData.winnerCount,
          totalEntries: listData.totalEntries,
          merkleRoot: listData.merkleRoot,
          commitBlock: listData.commitBlock,
          onChainRaffleId: null,
          txHash: null,
          contractAddress: COSMIC_RAFFLE_ADDRESS,
          rawEntries: listData.rawInput,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Error saving raffle details.')
      }

      setStatusText('Success! Redirecting...')
      router.push(`/raffle/${json.raffle.id}`)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="border border-white/5 bg-slate-950/60 rounded-xl p-5 space-y-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Raffle Campaign Overview</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs leading-relaxed">
          <div className="space-y-1">
            <span className="text-slate-500 block">Title:</span>
            <strong className="text-slate-200 text-sm">{infoData.title}</strong>
          </div>
          {infoData.prizeDescription && (
            <div className="space-y-1">
              <span className="text-slate-500 block">Prize Reward:</span>
              <strong className="text-amber-400 text-sm">{infoData.prizeDescription}</strong>
            </div>
          )}
          <div className="space-y-1">
            <span className="text-slate-500 block">Total Contestants:</span>
            <strong className="text-slate-200">{listData.totalEntries} contestants</strong>
          </div>
          <div className="space-y-1">
            <span className="text-slate-500 block">Winner Count:</span>
            <strong className="text-slate-200">{infoData.winnerCount} winners</strong>
          </div>
          <div className="space-y-1 md:col-span-2">
            <span className="text-slate-500 block">Target Space Block:</span>
            <strong className="text-indigo-400">Block #{listData.commitBlock}</strong>
          </div>
          <div className="space-y-1 md:col-span-2">
            <span className="text-slate-500 block">Cryptographic Merkle Root:</span>
            <strong className="text-cyan-400 font-mono block truncate">{listData.merkleRoot}</strong>
          </div>
          <div className="space-y-1 md:col-span-2 border-t border-white/5 pt-2.5 flex justify-between items-center text-xs">
            <span className="text-slate-500 font-semibold uppercase tracking-wider text-[9px]">Est. Draw Gas Fee:</span>
            <strong className="text-cyan-400 font-mono">
              {estimatedFee ? `~${estimatedFee} ARC` : 'Estimating gas fee...'}
            </strong>
          </div>
        </div>

        {infoData.description && (
          <div className="pt-3 border-t border-white/5 text-xs text-slate-400">
            <span className="text-slate-500 block mb-1">Description:</span>
            {infoData.description}
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md">
          {error}
        </div>
      )}

      {loading && (
        <div className="p-4 border border-cyan-500/20 bg-cyan-950/10 rounded-xl space-y-2.5 animate-pulse text-center">
          <Loader2 className="h-6 w-6 animate-spin text-cyan-400 mx-auto" />
          <span className="text-xs text-slate-300 font-semibold block uppercase tracking-wider">{statusText}</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between items-center pt-2">
        <Button
          type="button"
          onClick={onPrev}
          disabled={loading}
          className="flex items-center gap-1 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 text-xs px-4 py-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <Button
          type="button"
          onClick={handleCreate}
          disabled={loading}
          className="flex items-center gap-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-slate-950 font-bold uppercase tracking-wider text-xs px-6 py-2.5 rounded-lg shadow-lg disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4 text-slate-950" />
          Create Raffle Campaign
        </Button>
      </div>
    </div>
  )
}
