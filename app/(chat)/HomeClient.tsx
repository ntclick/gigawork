'use client'

import { useEffect, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'


import { MainHeader } from '@/components/shell/MainHeader'

import { StatsCards } from '@/components/dashboard/StatsCards'
import { LiveStream } from '@/components/dashboard/LiveStream'
import { EndpointDirectory } from '@/components/dashboard/EndpointDirectory'
import { WithdrawalConsole } from '@/components/dashboard/WithdrawalConsole'
import { AgentEndpoint } from '@/lib/nanopayments/config'
import { RequestLog } from '@/lib/chain/nanopayments'

export function HomeClient() {
  const { user: privyUser } = usePrivy()
  const wallet = useActiveWallet()
  
  // Dashboard states
  const [totalRevenueUsdc, setTotalRevenueUsdc] = useState<number>(0.0)
  const [totalApiCalls, setTotalApiCalls] = useState<number>(0)
  const [totalFailedCalls, setTotalFailedCalls] = useState<number>(0)
  const [activeBuyersCount, setActiveBuyersCount] = useState<number>(0)
  const [settlementQueue, setSettlementQueue] = useState<any[]>([])
  const [requestLogs, setRequestLogs] = useState<RequestLog[]>([])
  const [endpoints, setEndpoints] = useState<AgentEndpoint[]>([])
  
  // Polling state
  const [isPolling, setIsPolling] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch stats function
  const fetchStats = async () => {
    try {
      const res = await fetch('/api/dashboard/stats', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch dashboard metrics')
      const data = await res.json()
      
      setTotalRevenueUsdc(data.totalRevenueUsdc)
      setTotalApiCalls(data.totalApiCalls)
      setTotalFailedCalls(data.totalFailedCalls)
      setActiveBuyersCount(data.activeBuyersCount)
      setSettlementQueue(data.settlementQueue)
      setEndpoints(data.endpoints)
      
      // Update logs only if we are actively streaming
      if (isPolling) {
        setRequestLogs(data.requestLogs)
      }
      
      setError(null)
    } catch (err) {
      console.error('[dashboard] error fetching stats:', err)
      setError('Connection to metrics API lost. Retrying...')
    }
  }

  // Setup periodic polling
  useEffect(() => {
    fetchStats()
    const timer = setInterval(() => {
      fetchStats()
    }, 2500)
    
    return () => clearInterval(timer)
  }, [isPolling])

  // Update Endpoint Config Action
  const handleUpdateEndpoint = async (skill: string, enabled: boolean, priceUsdc: string) => {
    try {
      const res = await fetch('/api/dashboard/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill, enabled, priceUsdc }),
      })
      if (!res.ok) throw new Error('Failed to update endpoint configuration')
      await fetchStats() // immediately refresh
    } catch (err) {
      console.error('[dashboard] failed to update endpoint:', err)
    }
  }

  // Settle/Reset Revenue Console Action
  const handleResetRevenue = async () => {
    try {
      const res = await fetch('/api/dashboard/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'withdraw' }),
      })
      if (!res.ok) throw new Error('Failed to reset revenue metrics')
      await fetchStats() // immediately refresh
    } catch (err) {
      console.error('[dashboard] failed to reset revenue:', err)
    }
  }

  const handleClearLogs = () => {
    setRequestLogs([])
  }

  return (
    <>
      <MainHeader />
      <main className="giga-theme giga-grid-bg flex flex-1 flex-col overflow-y-auto bg-[var(--giga-dark)] p-6 sm:p-8">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
          
          {/* ─── HUD HEADER ─── */}
          <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border border-white/5 bg-[rgba(10,8,20,0.45)] backdrop-blur-md p-5 rounded-2xl relative overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-cyan-500/5 pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                <span className="font-mono text-[9px] uppercase tracking-widest text-emerald-300 font-bold">
                  AGENT PROVIDER ONLINE · ARC TESTNET · ERC-8004
                </span>
              </div>
              <h2 className="font-pixel-header text-xl sm:text-2xl font-black tracking-tight text-white mb-1.5 uppercase drop-shadow-[0_0_12px_rgba(255,255,255,0.15)]">
                GigaWork Agent Dashboard
              </h2>
              <p className="text-xs text-white/50 leading-relaxed font-mono uppercase tracking-wide">
                Monitor x402 USDC nanopayments, manage agent endpoints, and track ERC-8183 settlements.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2.5 rounded-xl border border-rose-500/15 bg-rose-950/15 px-3.5 py-2.5 text-rose-400 font-mono text-xs animate-pulse">
                {error}
              </div>
            )}
          </header>

          {/* ─── STATS METRIC CARDS ─── */}
          <StatsCards
            totalRevenueUsdc={totalRevenueUsdc}
            totalApiCalls={totalApiCalls}
            totalFailedCalls={totalFailedCalls}
            activeBuyersCount={activeBuyersCount}
            settledCount={settlementQueue.length}
          />

          {/* ─── ENDPOINTS & WITHDRAWAL SECTION ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="lg:col-span-2">
              <EndpointDirectory
                endpoints={endpoints}
                onUpdateEndpoint={handleUpdateEndpoint}
              />
            </div>
            <div className="lg:col-span-1">
              <WithdrawalConsole
                totalRevenueUsdc={totalRevenueUsdc}
                settlementQueueCount={settlementQueue.length}
                onResetRevenue={handleResetRevenue}
              />
            </div>
          </div>

          {/* ─── LIVE STREAM M2M LOGS ─── */}
          <LiveStream
            logs={requestLogs}
            onClear={handleClearLogs}
            isPolling={isPolling}
            onTogglePolling={() => setIsPolling(!isPolling)}
          />

        </div>
      </main>
    </>
  )
}
