'use client'

import { useCallback } from 'react'
import { ethers } from 'ethers'
import { useWallets } from '@privy-io/react-auth'
import { COMMERCE_ABI, ERC20_ABI, STAKING_ABI } from '@/lib/abi'

const COMMERCE = process.env.NEXT_PUBLIC_COMMERCE_ADDRESS!
const USDC = process.env.NEXT_PUBLIC_USDC_ADDRESS!
const STAKING = process.env.NEXT_PUBLIC_STAKING_ADDRESS!
const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC || 'https://rpc.testnet.arc.network'

const ARC_GAS = {
  maxFeePerGas: ethers.parseUnits('200', 'gwei'),
  maxPriorityFeePerGas: ethers.parseUnits('10', 'gwei'),
  type: 2,
}

const arcReadProvider = new ethers.JsonRpcProvider(ARC_RPC)

async function waitForTx(tx: ethers.TransactionResponse, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    try {
      const receipt = await arcReadProvider.getTransactionReceipt(tx.hash)
      if (receipt?.blockNumber) return receipt
    } catch {}
  }
  throw new Error('Transaction timeout: ' + tx.hash)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export function useContracts() {
  const { wallets } = useWallets()

  const getSigner = useCallback(async () => {
    // Prefer Privy embedded wallet, fallback to external (MetaMask/OKX)
    const embedded = wallets.find((w) => w.walletClientType === 'privy')
    const wallet = embedded || wallets[0]
    if (!wallet) throw new Error('No wallet connected')
    try { await wallet.switchChain(5042002) } catch {}
    const provider = await wallet.getEthereumProvider()
    const ethersProvider = new ethers.BrowserProvider(provider)
    return ethersProvider.getSigner()
  }, [wallets])

  const createJobOnChain = useCallback(async (provider: string, evaluator: string, expiredAt: number, description: string) => {
    const signer = await getSigner()
    const commerce = new ethers.Contract(COMMERCE, COMMERCE_ABI, signer)
    const tx = await commerce.createJob(provider || ethers.ZeroAddress, evaluator, expiredAt, description, '0x', ARC_GAS)
    const receipt = await waitForTx(tx)

    let jobId: string | null = null
    const iface = new ethers.Interface(COMMERCE_ABI)
    for (const log of receipt!.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
        if (parsed?.name === 'JobCreated') {
          jobId = parsed.args.jobId.toString()
          break
        }
      } catch {}
    }
    return { tx, receipt, jobId }
  }, [getSigner])

  const setBudgetOnChain = useCallback(async (jobId: string | number, amount: bigint) => {
    const signer = await getSigner()
    const nonce = await arcReadProvider.getTransactionCount(await signer.getAddress(), 'pending')
    const commerce = new ethers.Contract(COMMERCE, COMMERCE_ABI, signer)
    const tx = await commerce.setBudget(jobId, amount, '0x', { ...ARC_GAS, nonce })
    await waitForTx(tx)
    return tx
  }, [getSigner])

  const fundJobOnChain = useCallback(async (jobId: string | number, budget: bigint) => {
    const signer = await getSigner()
    const addr = await signer.getAddress()

    // Approve
    const usdcRead = new ethers.Contract(USDC, ERC20_ABI, arcReadProvider)
    const allowance = await usdcRead.allowance(addr, COMMERCE)
    if (allowance < budget) {
      const usdc = new ethers.Contract(USDC, ERC20_ABI, signer)
      const approveTx = await usdc.approve(COMMERCE, budget, ARC_GAS)
      await waitForTx(approveTx)
      await sleep(2000)
    }

    // Fund
    const commerce = new ethers.Contract(COMMERCE, COMMERCE_ABI, signer)
    const tx = await commerce.fund(jobId, budget, '0x', ARC_GAS)
    const receipt = await waitForTx(tx)
    return { tx, receipt }
  }, [getSigner])

  const completeJobOnChain = useCallback(async (jobId: string | number) => {
    const signer = await getSigner()
    const commerce = new ethers.Contract(COMMERCE, COMMERCE_ABI, signer)
    const tx = await commerce.complete(jobId, ethers.ZeroHash, '0x', ARC_GAS)
    await waitForTx(tx)
    return tx
  }, [getSigner])

  const bidOnChain = useCallback(async (jobId: number, note: string) => {
    const signer = await getSigner()
    const commerce = new ethers.Contract(COMMERCE, COMMERCE_ABI, signer)
    const tx = await commerce.bid(jobId, note, ARC_GAS)
    await waitForTx(tx)
    return tx
  }, [getSigner])

  const registerAgentOnChain = useCallback(async (tokenId: number, rateUSDC: number, tags: string[]) => {
    const signer = await getSigner()
    const registry = new ethers.Contract(
      '0x26BAB1CD090c1a44C189dCfd9D32d3AC80bfD0d1',
      ['function register(uint256, uint256, string[])'],
      signer
    )
    const rate = ethers.parseUnits(rateUSDC.toString(), 6)
    const tx = await registry.register(tokenId, rate, tags, ARC_GAS)
    await waitForTx(tx)
    return tx
  }, [getSigner])

  const stakeUSDC = useCallback(async (amount: number) => {
    const signer = await getSigner()
    const parsed = ethers.parseUnits(amount.toString(), 6)

    const usdc = new ethers.Contract(USDC, ERC20_ABI, signer)
    const approveTx = await usdc.approve(STAKING, parsed, ARC_GAS)
    await waitForTx(approveTx)
    await sleep(2000)

    const staking = new ethers.Contract(STAKING, STAKING_ABI, signer)
    const tx = await staking.stake(parsed, ARC_GAS)
    await waitForTx(tx)
    return tx
  }, [getSigner])

  const getStakeInfo = useCallback(async (address: string) => {
    const staking = new ethers.Contract(STAKING, STAKING_ABI, arcReadProvider)
    const stake = await staking.getStake(address)
    const tier = await staking.getTier(address)
    return {
      amount: parseFloat(ethers.formatUnits(stake.amount, 6)),
      tier: Number(tier),
      status: Number(stake.status),
    }
  }, [])

  return {
    getSigner,
    createJobOnChain,
    setBudgetOnChain,
    fundJobOnChain,
    completeJobOnChain,
    bidOnChain,
    registerAgentOnChain,
    stakeUSDC,
    getStakeInfo,
    parseUSDC: (amount: number) => ethers.parseUnits(amount.toString(), 6),
    sleep,
  }
}
