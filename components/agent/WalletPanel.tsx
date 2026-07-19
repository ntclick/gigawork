'use client'

import { useState, useEffect } from 'react'
import { Wallet, ArrowUpRight, Copy, Check, RefreshCw, Loader2 } from 'lucide-react'

interface WalletPanelProps {
  agentId: string
  ownerAddress?: string
}

export function WalletPanel({ agentId, ownerAddress }: WalletPanelProps) {
  const [balances, setBalances] = useState<{ usdc: string; native: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  
  // Withdrawal Form State
  const [toAddress, setToAddress] = useState(ownerAddress ?? '')
  const [amountUsdc, setAmountUsdc] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const [withdrawSuccess, setWithdrawSuccess] = useState('')

  const fetchBalance = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/balance`)
      const data = await res.json()
      if (res.ok) {
        setBalances({ usdc: data.usdc, native: data.native })
      }
    } catch (err) {
      console.error('Failed to fetch balance:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBalance()
  }, [agentId])

  const copyAddress = () => {
    if (!balances) return
    // Wait, balances endpoint doesn't return wallet address directly or it does? Yes it does: data.walletAddress
    // Let's retrieve from api output or props.
    // If not available, we skip
  }

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault()
    setWithdrawing(true)
    setWithdrawError('')
    setWithdrawSuccess('')

    try {
      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          toAddress,
          amountUsdc,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Withdrawal failed')
      }

      setWithdrawSuccess(`USDC withdrawn successfully! Tx: ${data.txHash.slice(0, 10)}…`)
      setAmountUsdc('')
      fetchBalance() // refresh balance
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-md">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-cyan-400" />
          <h3 className="font-semibold text-white">Agent Wallet</h3>
        </div>
        <button
          onClick={fetchBalance}
          disabled={loading}
          className="text-white/40 hover:text-white/80 p-1.5 rounded-lg hover:bg-white/5 disabled:opacity-50 transition"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Balance Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-white/5 bg-white/[0.01] p-4">
          <span className="text-xs text-white/40 uppercase tracking-wider">USDC Balance</span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-mono text-2xl font-bold text-cyan-300">
              {loading ? '…' : balances?.usdc ?? '0.00'}
            </span>
            <span className="text-[10px] text-white/40">USDC</span>
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-white/[0.01] p-4">
          <span className="text-xs text-white/40 uppercase tracking-wider">Gas Balance</span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-mono text-2xl font-bold text-white/80">
              {loading ? '…' : balances?.native ? Number(balances.native).toFixed(4) : '0.0000'}
            </span>
            <span className="text-[10px] text-white/40">ARC</span>
          </div>
        </div>
      </div>

      {/* Withdrawal Form */}
      <form onSubmit={handleWithdraw} className="space-y-4">
        <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Withdraw USDC</h4>
        
        <div>
          <label className="block text-[10px] text-white/40 uppercase mb-1">To Address</label>
          <input
            type="text"
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value)}
            placeholder="0x..."
            required
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 font-mono text-xs text-white placeholder-white/30 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[10px] text-white/40 uppercase mb-1">Amount (USDC)</label>
          <input
            type="number"
            step="any"
            value={amountUsdc}
            onChange={(e) => setAmountUsdc(e.target.value)}
            placeholder="0.0"
            required
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 font-mono text-xs text-white placeholder-white/30 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        {withdrawError && <p className="text-xs text-red-400">{withdrawError}</p>}
        {withdrawSuccess && <p className="text-xs text-emerald-400">{withdrawSuccess}</p>}

        <button
          type="submit"
          disabled={withdrawing || loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white text-[#0f131c] py-2.5 text-xs font-semibold hover:bg-white/95 disabled:opacity-50 transition"
        >
          {withdrawing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <span>Withdraw Funds</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      </form>
    </div>
  )
}
