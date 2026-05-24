'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, ArrowLeft, ShieldAlert } from 'lucide-react'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { usePrivy } from '@privy-io/react-auth'
import { Button } from '@/components/ui/button'
import { createPublicClient, createWalletClient, http, custom, encodeFunctionData, decodeEventLog } from 'viem'
import { arcTestnet, ARC_CHAIN_ID } from '@/lib/chain/arcTestnet'
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

const COSMIC_RAFFLE_ADDRESS = (process.env.NEXT_PUBLIC_COSMIC_RAFFLE_ADDRESS || '0x82de8cce43a62964e77f5f939977da4864df20f2') as `0x${string}`

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

        const gas = await publicClient.estimateContractGas({
          address: COSMIC_RAFFLE_ADDRESS,
          abi: CosmicRaffleArtifact.abi,
          functionName: 'createRaffle',
          account: activeWallet.address as `0x${string}`,
          args: [
            infoData.title,
            listData.merkleRoot,
            BigInt(listData.totalEntries),
            BigInt(infoData.winnerCount),
            BigInt(listData.commitBlock),
          ],
        })

        const gasPrice = await publicClient.getGasPrice()
        const totalFee = gas * gasPrice
        // Arc Testnet native gas is USDC (18 decimals formatted natively)
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

      // 2. Ensure we are connected to the Arc Testnet
      setStatusText('Requesting network switch to Arc Testnet...')
      try {
        await wallet.switchChain(ARC_CHAIN_ID)
      } catch (err) {
        console.warn('switchChain failed, user might have declined or chain already active', err)
      }

      // 3. Initialize Viem Clients for wallet interaction
      const provider = await wallet.getEthereumProvider()
      const walletClient = createWalletClient({
        chain: arcTestnet,
        transport: custom(provider),
      })

      const publicClient = createPublicClient({
        chain: arcTestnet,
        transport: http(process.env.NEXT_PUBLIC_ARC_RPC || 'https://rpc.testnet.arc.network'),
      })

      // 4. Encode contract call data for createRaffle
      setStatusText('Encoding transaction call data...')
      const callData = encodeFunctionData({
        abi: CosmicRaffleArtifact.abi,
        functionName: 'createRaffle',
        args: [
          infoData.title,
          listData.merkleRoot,
          BigInt(listData.totalEntries),
          BigInt(infoData.winnerCount),
          BigInt(listData.commitBlock),
        ],
      })

      // 5. Submit transaction via user wallet
      setStatusText('Please sign the creation transaction in your wallet...')
      const txHash = await walletClient.sendTransaction({
        account: wallet.address as `0x${string}`,
        to: COSMIC_RAFFLE_ADDRESS,
        data: callData,
      })

      // 6. Wait for transaction block receipt confirmation
      setStatusText('Waiting for transaction confirmation (~3-5s)...')
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
        timeout: 90_000,
      })

      if (receipt.status !== 'success') {
        throw new Error('On-chain creation transaction failed or was reverted.')
      }

      // 7. Get the generated on-chain raffleId from events
      setStatusText('Extracting raffle ID from transaction logs...')
      let onChainRaffleId: number | null = null

      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: CosmicRaffleArtifact.abi,
            data: log.data,
            topics: log.topics,
          })
          if (decoded.eventName === 'RaffleCreated' && decoded.args) {
            const args = decoded.args as any
            onChainRaffleId = Number(args.raffleId)
            break
          }
        } catch (e) {
          // skip non-matching logs
        }
      }

      if (onChainRaffleId === null) {
        throw new Error('Could not find RaffleCreated event in transaction logs.')
      }

      // 8. Store finalized raffle record in database cache
      setStatusText('Saving raffle details in database...')
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
          onChainRaffleId: onChainRaffleId, // actual on-chain generated id
          txHash, // the actual creation transaction hash
          contractAddress: COSMIC_RAFFLE_ADDRESS, // using single shared contract address
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
            <span className="text-slate-500 font-semibold uppercase tracking-wider text-[9px]">Estimated Gas Fee:</span>
            <strong className="text-cyan-400 font-mono">
              {estimatedFee ? `~${estimatedFee} USDC` : 'Estimating gas fee...'}
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

      <div className="p-4 border border-amber-500/20 bg-amber-500/5 rounded-lg flex items-start gap-2.5 text-xs text-amber-300">
        <ShieldAlert className="h-4.5 w-4.5 shrink-0 text-amber-400 mt-0.5" />
        <div className="leading-relaxed">
          <strong>Blockchain Transaction Required:</strong> This action will request you to sign a transaction on the Arc Testnet. 
          Gas fees will be automatically deducted from your wallet balance in native **USDC**.
        </div>
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
          className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-bold uppercase tracking-wider text-xs px-6 py-2.5 rounded-lg shadow-lg disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4 text-slate-950" />
          Create Raffle Campaign
        </Button>
      </div>
    </div>
  )
}
