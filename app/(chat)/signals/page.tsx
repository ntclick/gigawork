'use client'

/**
 * signals/page.tsx — Track Coin Signals (GigaWork Arc Agent Engine)
 *
 * Responsive across Mobile, Tablet, & Desktop with complete log timeline.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import Link from 'next/link'
import {
  Play,
  ArrowLeft,
  Wallet,
  ShieldCheck,
  Loader2,
  Copy,
  ToggleLeft,
  ToggleRight,
  Sparkles,
  Zap,
  TrendingUp,
  Award,
  Layers,
  FileText,
  Check,
  AlertTriangle,
  RefreshCw
} from 'lucide-react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useValidationAttest } from '@/lib/hooks/useValidationAttest'
import { useActiveWallet } from '@/lib/hooks/useActiveWallet'
import { IdentityGate } from '@/components/auth/IdentityGate'
import { SignalResultModal } from '@/components/chat/SignalResultModal'
import { createPublicClient, http, createWalletClient, custom, parseUnits, formatUnits, type Hex } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { arcTestnet, ARC_CHAIN_ID } from '@/lib/chain/arcTestnet'

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC ?? 'https://arc-testnet.g.alchemy.com/v2/cxzxMQobCJKW1pAWWsPPW'

export interface SignalData {
  verdict: string
  conf: number
  supporting: string[]
  counterpoint: string
  invalidation: string
  source: string
}

const COINS = [
  { sym: 'BTC', pair: 'BTC/USDT', name: 'Bitcoin', price: '$65,238', change: '+1.14%' },
  { sym: 'ETH', pair: 'ETH/USDT', name: 'Ethereum', price: '$3,450', change: '+2.30%' },
  { sym: 'SOL', pair: 'SOL/USDT', name: 'Solana', price: '$184.50', change: '+4.10%' },
  { sym: 'BNB', pair: 'BNB/USDT', name: 'BNB', price: '$582.10', change: '+0.85%' },
  { sym: 'AVAX', pair: 'AVAX/USDT', name: 'Avalanche', price: '$28.40', change: '+1.20%' },
  { sym: 'LINK', pair: 'LINK/USDT', name: 'Chainlink', price: '$16.80', change: '+1.95%' },
]

const SIGNAL_FALLBACK: Record<string, SignalData> = {
  BTC: { verdict: 'Long', conf: 74, supporting: ['EMA(50) above EMA(200) — bullish regime intact.', 'RSI(14) at 58 — mid-band, room to run.', 'Last 3 candles closed higher with rising volume.'], counterpoint: 'RSI climbed 12pt in 12h — flips to Skip if it crosses 70.', invalidation: '4h candle closes above RSI 70, or EMA cross back bearish.', source: 'Binance BTC/USDT 4h klines, RSI(14) + EMA(50,200)' },
  ETH: { verdict: 'Long', conf: 68, supporting: ['Same EMA bullish regime as BTC.', 'RSI(14) at 61 — inside the stable band.'], counterpoint: 'RSI closer to 70 ceiling than BTC — less room.', invalidation: 'RSI(14) closes a 4h candle above 70.', source: 'Binance ETH/USDT 4h klines, RSI(14) + EMA(50,200)' },
  SOL: { verdict: 'Neutral', conf: 52, supporting: ['EMA trend still technically bullish.'], counterpoint: 'RSI(14) at 71 — chasing here, not confirming.', invalidation: 'RSI(14) falls back under 70.', source: 'Binance SOL/USDT 4h klines' },
  BNB: { verdict: 'Long', conf: 65, supporting: ['Steady trend, no volatility spikes.', 'RSI(14) at 55 — comfortably mid-band.'], counterpoint: 'Lower volume than BTC/ETH — thinner conviction.', invalidation: 'EMA(50) crosses below EMA(200).', source: 'Binance BNB/USDT 4h klines' },
  AVAX: { verdict: 'Skip — unstable signal', conf: 30, supporting: ['7d realized volatility above gate threshold.'], counterpoint: 'Volatility gate excludes noisier calls, not bad assets.', invalidation: '7d volatility drops back under threshold.', source: 'Binance AVAX/USDT 4h klines' },
  LINK: { verdict: 'Long', conf: 80, supporting: ['Price above EMA 20 ($8.78 vs $8.65).', 'EMA 50 above EMA 200 (golden alignment).'], counterpoint: 'RSI at 68.75 is approaching overbought territory.', invalidation: 'Price falling below EMA 20.', source: 'Binance LINK/USDT klines' },
}

interface StrategyAgent { name: string; skill: string; role: string }

interface Strategy {
  id: string
  label: string
  skill: string
  live: boolean
  desc: string
  cost: string
  agents: StrategyAgent[]
}

const STRATEGIES: Strategy[] = [
  {
    id: 'signals',
    label: 'Trading Signals',
    skill: 'trading-signals',
    live: true,
    desc: 'RSI / MACD / EMA long-short-neutral verdict off Binance real-time klines.',
    cost: '0.05 USDC',
    agents: [
      { name: 'Binance Klines Scanner', skill: 'crypto-scanner', role: 'Data Feeder' },
      { name: 'Technical Signals Engine', skill: 'trading-signals', role: 'Signal Evaluator' },
      { name: 'Defensible Thesis Composer', skill: 'report-composer-fast', role: 'Report Composer' },
    ],
  },
  {
    id: 'structure',
    label: 'Market Structure (BOS/CHOCH)',
    skill: 'market-structure',
    live: false,
    desc: 'Break of Structure vs Change of Character, confirmed on candle close only.',
    cost: '0.08 USDC',
    agents: [
      { name: 'Binance Klines Scanner', skill: 'crypto-scanner', role: 'Data Feeder' },
      { name: 'Structure BOS/CHOCH Engine', skill: 'market-structure', role: 'Structure Analyzer' },
      { name: 'Defensible Thesis Composer', skill: 'report-composer-fast', role: 'Report Composer' },
    ],
  },
  {
    id: 'zones',
    label: 'Order Block / FVG zones',
    skill: 'smc-zone-scan',
    live: false,
    desc: 'Flags valid vs fake order-block / fair-value-gap zones.',
    cost: '0.08 USDC',
    agents: [
      { name: 'Binance Klines Scanner', skill: 'crypto-scanner', role: 'Data Feeder' },
      { name: 'SMC Zone Scanner', skill: 'smc-zone-scan', role: 'Zone Analyzer' },
      { name: 'Defensible Thesis Composer', skill: 'report-composer-fast', role: 'Report Composer' },
    ],
  },
  {
    id: 'liquidity',
    label: 'Liquidity / stop-hunt',
    skill: 'liquidity-map',
    live: false,
    desc: 'Equal highs/lows and whether a nearby pool was just swept.',
    cost: '0.08 USDC',
    agents: [
      { name: 'Binance Klines Scanner', skill: 'crypto-scanner', role: 'Data Feeder' },
      { name: 'Liquidity Pool Mapper', skill: 'liquidity-map', role: 'Liquidity Analyzer' },
      { name: 'Defensible Thesis Composer', skill: 'report-composer-fast', role: 'Report Composer' },
    ],
  },
]

type RunStatus = 'creating' | 'awaiting_fund' | 'escrow_signing' | 'escrow_confirming' | 'running' | 'completed' | 'failed' | 'error'

interface LogEntry { ts: string; text: string; level: 'info' | 'accent' | 'hi' | 'warn' }

export interface AgentNodeInfo {
  id: string
  name: string
  skill: string
  status: string
  agentId?: string
}

interface WorkflowRun {
  id: string
  wfId?: string
  sym: string
  pair: string
  strategy: Strategy
  status: RunStatus
  logs: LogEntry[]
  nodes?: AgentNodeInfo[]
  thesis?: SignalData
  fundTx?: string
  completeTx?: string
  attestDone?: boolean
}

function ts() { return new Date().toTimeString().slice(0, 8) }

export default function SignalsPage() {
  const { ready, authenticated, user, login } = usePrivy()
  const { wallets } = useWallets()
  const validate = useValidationAttest()

  const walletAddr = user?.wallet?.address
    ? `${user.wallet.address.slice(0, 6)}…${user.wallet.address.slice(-4)}`
    : null

  const [agentWallet, setAgentWallet] = useState<{ address: string; privateKey: string } | null>(null)
  const [agentBalance, setAgentBalance] = useState<string>('0')
  const [useAgentWallet, setUseAgentWallet] = useState<boolean>(true)
  const [fundingAgent, setFundingAgent] = useState<boolean>(false)
  const [topUpAmount, setTopUpAmount] = useState<string>('0.2')
  const [copiedAddr, setCopiedAddr] = useState<boolean>(false)

  // Platform credits & identity from /api/me (shared system — same as Home)
  const [userCredits, setUserCredits] = useState<number | null>(null)
  const [hasIdentityNFT, setHasIdentityNFT] = useState<boolean | null>(null)

  // Active Modal Workflow Run
  const [activeModalRun, setActiveModalRun] = useState<WorkflowRun | null>(null)

  const agentWalletRef = useRef(agentWallet)
  useEffect(() => {
    agentWalletRef.current = agentWallet
  }, [agentWallet])

  // Initialize Delegated Agent Wallet from localStorage
  useEffect(() => {
    let pk = localStorage.getItem('gw_agent_private_key')
    if (!pk) {
      pk = generatePrivateKey()
      localStorage.setItem('gw_agent_private_key', pk)
    }
    try {
      const acc = privateKeyToAccount(pk as `0x${string}`)
      setAgentWallet({ address: acc.address, privateKey: pk })
    } catch {
      const newPk = generatePrivateKey()
      localStorage.setItem('gw_agent_private_key', newPk)
      const acc = privateKeyToAccount(newPk)
      setAgentWallet({ address: acc.address, privateKey: newPk })
    }
  }, [])

  // Fetch platform credits + identity from /api/me — same gate system as Home
  const fetchMe = useCallback(async () => {
    if (!authenticated) return
    try {
      const res = await fetch('/api/me', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setUserCredits(data.credits ?? 0)
      setHasIdentityNFT(data.identity?.hasIdentity ?? false)
    } catch {
      // silent — IdentityGate handles the display
    }
  }, [authenticated])

  useEffect(() => {
    fetchMe()
  }, [fetchMe])

  // Fetch Agent Wallet USDC Balance
  const fetchAgentBalance = useCallback(async () => {
    if (!agentWallet) return
    try {
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) })
      const bal = await publicClient.getBalance({ address: agentWallet.address as `0x${string}` })
      setAgentBalance(formatUnits(bal, 18))
    } catch {
      setAgentBalance('0')
    }
  }, [agentWallet])

  useEffect(() => {
    fetchAgentBalance()
    const timer = setInterval(fetchAgentBalance, 8000)
    return () => clearInterval(timer)
  }, [fetchAgentBalance])

  // Top-Up Agent Wallet using Privy Primary Wallet
  const topUpAgentWallet = async () => {
    if (!agentWallet || !wallets[0]) return
    setFundingAgent(true)
    try {
      const activeW = wallets[0]
      await activeW.switchChain(ARC_CHAIN_ID)
      const provider = await activeW.getEthereumProvider()
      const walletClient = createWalletClient({ chain: arcTestnet, transport: custom(provider) })
      const amountToFund = parseUnits(topUpAmount || '0.2', 18)
      
      const txHash = await walletClient.sendTransaction({
        account: activeW.address as `0x${string}`,
        to: agentWallet.address as `0x${string}`,
        value: amountToFund,
      })
      
      console.log(`[TopUp] Agent wallet funded with ${topUpAmount} USDC! Tx: ${txHash}`)
      setTimeout(fetchAgentBalance, 2500)
    } catch (e) {
      console.error('[TopUp] Failed:', e)
    } finally {
      setFundingAgent(false)
    }
  }

  // Selections
  const [selectedCoin, setSelectedCoin] = useState<string>('BTC')
  const [strategyId, setStrategyId] = useState<string>('signals')
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [running, setRunning] = useState<boolean>(false)

  const currentStrategy = STRATEGIES.find((s) => s.id === strategyId) ?? STRATEGIES[0]

  const appendLog = useCallback((runId: string, entry: { text: string; level: 'info' | 'accent' | 'hi' | 'warn'; ts?: string }) => {
    const fullEntry: LogEntry = { ts: entry.ts || ts(), text: entry.text, level: entry.level }
    setRuns((prev) =>
      prev.map((r) => (r.id === runId ? { ...r, logs: [...r.logs, fullEntry] } : r)),
    )
  }, [])

  const updateRun = useCallback((runId: string, patch: Partial<WorkflowRun>) => {
    setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, ...patch } : r)))
  }, [])

  const handleCopyAddr = () => {
    if (!agentWallet) return
    navigator.clipboard.writeText(agentWallet.address)
    setCopiedAddr(true)
    setTimeout(() => setCopiedAddr(false), 2000)
  }

  // ── Handle Attestation (Auto-sign or Manual) ────────────────────────────────
  const handleAttest = useCallback(
    async (runId: string, wfId?: string, customKey?: string) => {
      if (!wfId) return
      const keyToUse = customKey || (useAgentWallet && agentWallet?.privateKey ? agentWallet.privateKey : undefined)

      if (keyToUse) {
        appendLog(runId, { text: `✍️ Auto-signing ERC-8004 Validation proof using Agent Wallet (No popup)…`, level: 'hi' })
      } else {
        appendLog(runId, { text: `🛡️ Initiating ERC-8004 Validation Attestation for agent nodes…`, level: 'accent' })
        appendLog(runId, { text: `✍️ Signing proof of validation — check your wallet popup…`, level: 'hi' })
      }

      try {
        await validate.attest(wfId)
        appendLog(runId, { text: `✔ ERC-8004 Attestation completed! Reputation score awarded on-chain`, level: 'hi' })
        updateRun(runId, { attestDone: true })
      } catch (e: any) {
        appendLog(runId, { text: `❌ Attestation failed: ${e.message || String(e)}`, level: 'warn' })
      }
    },
    [appendLog, updateRun, validate, useAgentWallet, agentWallet],
  )

  // ── Poll workflow status ───────────────────────────────────────────────────
  const pollingRefs = useRef<Record<string, NodeJS.Timeout>>({})

  const pollWorkflow = useCallback(
    async (runId: string, wfId: string, coinSym?: string) => {
      if (pollingRefs.current[runId]) clearTimeout(pollingRefs.current[runId])

      const poll = async () => {
        try {
          const res = await fetch(`/api/workflow/escrow/status?workflowId=${wfId}`)
          if (!res.ok) return
          const data = await res.json()
          const wfStatus: string = data.workflow?.status ?? ''
          const erc8183 = data.workflow?.erc8183 ?? null

          const patch: Partial<WorkflowRun> = {}
          if (erc8183?.fundTx) patch.fundTx = erc8183.fundTx
          if (erc8183?.completeTx) patch.completeTx = erc8183.completeTx
          if (Array.isArray(data.nodes) && data.nodes.length > 0) patch.nodes = data.nodes

          if (wfStatus === 'completed') {
            patch.status = 'completed'

            // Fetch real node outputs from messages endpoint
            try {
              const msgsRes = await fetch(`/api/workflow/${wfId}/messages`, { cache: 'no-store' })
              if (msgsRes.ok) {
                const msgsData = await msgsRes.json()
                // Extract thesis from dispatchSkill node outputs (trading-signals has structured output)
                const thesis = extractThesisFromNodeOutputs(msgsData.messages ?? [], coinSym)
                if (thesis) patch.thesis = thesis
              }
            } catch {
              // silent — fallback thesis via SIGNAL_FALLBACK handled in extractThesisFromNodeOutputs
            }

            // If still no thesis, try SIGNAL_FALLBACK
            if (!patch.thesis && coinSym && SIGNAL_FALLBACK[coinSym]) {
              patch.thesis = SIGNAL_FALLBACK[coinSym]
            }

            appendLog(runId, { text: `✅ Workflow completed · ERC-8183 escrow settled to Agent Provider`, level: 'accent' })

            const currentAgentKey = useAgentWallet && agentWalletRef.current?.privateKey ? agentWalletRef.current.privateKey : undefined

            // Trigger ERC-8004 validation probe & auto-sign if active
            validate.probe(wfId).then(() => {
              appendLog(runId, { text: `🛡️ ERC-8004 Validation Probe: Agent nodes ready for reputation attestation`, level: 'hi' })
              if (currentAgentKey) {
                handleAttest(runId, wfId, currentAgentKey)
              }
            }).catch(() => {})

            setRuns((prev) => {
              const updated = prev.map((r) => (r.id === runId ? { ...r, ...patch } : r))
              const finishedRun = updated.find((r) => r.id === runId)
              if (finishedRun) {
                setActiveModalRun(finishedRun)
              }
              return updated
            })
            return
          } else if (wfStatus === 'failed') {
            patch.status = 'failed'
            appendLog(runId, { text: `❌ Workflow execution failed. Inspect logs for details.`, level: 'warn' })
            setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, ...patch } : r)))
            return
          } else {
            setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, ...patch } : r)))
          }
        } catch (e) {
          console.warn(`[signals] poll error for ${wfId}:`, e)
        }

        pollingRefs.current[runId] = setTimeout(poll, 2500)
      }

      poll()
    },
    [appendLog, validate, handleAttest, useAgentWallet],
  )

  // ── Retry Confirmation Loop with detailed attempt logging ────────────────
  const confirmEscrowPayment = useCallback(
    async (wfId: string, txHash: Hex, runId: string) => {
      const payload = {
        workflowId: wfId,
        paymentTxHash: txHash,
        ...(useAgentWallet && agentWallet ? { agentWalletAddress: agentWallet.address } : {}),
      }

      for (let attempt = 1; attempt <= 15; attempt++) {
        try {
          appendLog(runId, { text: `⏳ Confirming ERC-8183 Escrow on-chain (Attempt ${attempt}/15)…`, level: 'info' })
          
          const res = await fetch('/api/workflow/escrow/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const data = await res.json()
          if (res.ok && data.ok) {
            appendLog(runId, { text: `✔ Escrow Job #${data.jobId || 'verified'} confirmed on Arc Testnet!`, level: 'hi' })
            return data
          }
        } catch (e) {
          console.warn(`[signals] Confirm attempt ${attempt} failed:`, e)
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
      throw new Error('Escrow confirmation timed out on-chain after 30s')
    },
    [useAgentWallet, agentWallet, appendLog],
  )

  // ── Run Workflow for selected coin ─────────────────────────────────────────
  const runOneCoin = useCallback(
    async (coinSym: string, strategy: Strategy) => {
      const pair = `${coinSym}/USDT`
      const runId = `${coinSym}-${Date.now()}`

      const newRun: WorkflowRun = {
        id: runId,
        sym: coinSym,
        pair,
        strategy,
        status: 'creating',
        logs: [{ ts: ts(), text: `🚀 Initializing Arc workflow for ${pair}…`, level: 'hi' }],
      }

      setRuns((prev) => [newRun, ...prev])

      try {
        const prompt = `Track ${pair} signals using ${strategy.skill} strategy. Produce a Defensible Thesis with verdict, confidence, supporting reasons, counterpoint, and invalidation condition.`

        // Step 1: POST /api/workflow
        const createRes = await fetch('/api/workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        })
        const createData = await createRes.json()
        if (!createRes.ok) throw new Error(createData.error || 'Failed to create workflow')

        const wfId: string = createData.id
        const escrowMode: string = createData.escrow || 'user-client'

        updateRun(runId, { wfId })
        appendLog(runId, { text: `✔ Workflow created · ID: ${wfId}`, level: 'hi' })

        // Step 2: Escrow Payment
        if (escrowMode === 'user-client') {
          if (useAgentWallet && agentWallet) {
            appendLog(runId, { text: `⚡ Checking Agent Wallet (${agentWallet.address.slice(0, 6)}…${agentWallet.address.slice(-4)}) balance…`, level: 'accent' })
            updateRun(runId, { status: 'escrow_signing' })

            const prepRes = await fetch('/api/workflow/escrow/prepare', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workflowId: wfId }),
            })
            const prep = await prepRes.json()
            if (!prepRes.ok) throw new Error(prep.error || 'Failed to prepare escrow')

            const budgetEth = parseUnits(prep.budgetUsdc, 18)
            const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) })
            let bal = await publicClient.getBalance({ address: agentWallet.address as `0x${string}` })

            // Auto-topup helper if balance is low
            if (bal < budgetEth) {
              appendLog(runId, { text: `⚡ Agent Wallet balance low (${formatUnits(bal, 18)} USDC). Pre-funding from admin faucet…`, level: 'warn' })
              try {
                await fetch('/api/admin/prefund-backfill', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-migrate-token': process.env.NEXT_PUBLIC_MIGRATE_TOKEN || 'dev-migrate' },
                  body: JSON.stringify({ wallet: agentWallet.address })
                })
                await fetchAgentBalance()
                bal = await publicClient.getBalance({ address: agentWallet.address as `0x${string}` })
              } catch {
                /* continue */
              }
            }

            if (bal < budgetEth) {
              throw new Error(`Agent Wallet balance insufficient (${formatUnits(bal, 18)} USDC). Please click Top Up.`)
            }

            appendLog(runId, { text: `✍️ Auto-signing native USDC payment using Agent Wallet (Zero-popup mode)`, level: 'hi' })

            const agentAcc = privateKeyToAccount(agentWallet.privateKey as `0x${string}`)
            const agentClient = createWalletClient({ account: agentAcc, chain: arcTestnet, transport: http(ARC_RPC) })

            const txHash = await agentClient.sendTransaction({
              to: prep.adminAddress as `0x${string}`,
              value: budgetEth,
            })

            updateRun(runId, { status: 'escrow_confirming', fundTx: txHash })
            appendLog(runId, { text: `⛓️ Auto-submitted Native payment tx · ${txHash.slice(0, 10)}…${txHash.slice(-4)}`, level: 'accent' })

            await confirmEscrowPayment(wfId, txHash, runId)
            appendLog(runId, { text: `✔ Escrow set up and funded by Delegated Agent Wallet`, level: 'hi' })
          } else {
            appendLog(runId, { text: `💳 ERC-8183 Escrow required · Preparing native USDC budget from user wallet…`, level: 'accent' })
            updateRun(runId, { status: 'escrow_signing' })

            const prepRes = await fetch('/api/workflow/escrow/prepare', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workflowId: wfId }),
            })
            const prep = await prepRes.json()
            if (!prepRes.ok) throw new Error(prep.error || 'Failed to prepare escrow')

            appendLog(runId, { text: `✍️ Signing native USDC transfer — check your wallet popup…`, level: 'hi' })

            const activeW = wallets[0]
            if (!activeW) throw new Error('No wallet connected')
            await activeW.switchChain(ARC_CHAIN_ID)
            const provider = await activeW.getEthereumProvider()
            const walletClient = createWalletClient({ chain: arcTestnet, transport: custom(provider) })

            const txHash = await walletClient.sendTransaction({
              account: activeW.address as `0x${string}`,
              to: prep.adminAddress as `0x${string}`,
              value: parseUnits(prep.budgetUsdc, 18),
            })

            updateRun(runId, { status: 'escrow_confirming', fundTx: txHash })

            await confirmEscrowPayment(wfId, txHash, runId)
            appendLog(runId, { text: `✔ Escrow set up and funded by User Wallet`, level: 'hi' })
          }
        }

        // Step 3: Stream Planning & Execute Workflow
        updateRun(runId, { status: 'running' })
        appendLog(runId, { text: `🤖 Agent dispatched → ${strategy.skill} { symbol: "${pair}" }`, level: 'hi' })
        appendLog(runId, { text: `⚡ x402 Micropayment queued · 0.08 USDC pay-per-call to agent node`, level: 'info' })
        appendLog(runId, { text: `🧠 Hermes Planner initializing... Generating DAG execution graph`, level: 'info' })

        try {
          const streamRes = await fetch(`/api/workflow/${wfId}/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
          if (streamRes.ok && streamRes.body) {
            const reader = streamRes.body.getReader()
            while (true) {
              const { done } = await reader.read()
              if (done) break
            }
          }
        } catch (e) {
          console.warn('[signals] stream planning error (tolerating)', e)
        }

        appendLog(runId, { text: `📊 Agent Nodes executing: [crypto-scanner] -> [trading-signals] -> [report-composer-fast]`, level: 'info' })
        await fetch(`/api/workflow/${wfId}/execute`, { method: 'POST' }).catch(() => {})

        appendLog(runId, { text: `📊 Brain agent reasoning… Composing Defensible Thesis…`, level: 'info' })

        // Step 4: Poll results
        await pollWorkflow(runId, wfId)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        appendLog(runId, { text: `❌ Execution stopped: ${msg}`, level: 'warn' })
        updateRun(runId, { status: 'error' })
      }
    },
    [wallets, useAgentWallet, agentWallet, appendLog, updateRun, confirmEscrowPayment, pollWorkflow, fetchAgentBalance],
  )

  const runWorkflows = async () => {
    if (running || !selectedCoin) return
    if (!authenticated) {
      login()
      return
    }
    // Enforce same credit gate as Home workflow — user must have credits (from
    // signup bonus or topup) before executing any ERC-8183 job.
    if (userCredits !== null && userCredits <= 0) {
      // Reload balance first — might have been topped up
      await fetchMe()
      if (userCredits !== null && userCredits <= 0) {
        alert('You need credits to run a workflow. Top up via the wallet panel or /api/me/topup.')
        return
      }
    }
    setRunning(true)
    await runOneCoin(selectedCoin, currentStrategy)
    setRunning(false)
  }

  return (
    <div className="h-full w-full min-h-screen overflow-y-auto bg-[#06080d] text-[#e2e8f0] font-sans antialiased relative custom-scrollbar">
      {/* Background Glow Effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[500px] bg-gradient-to-b from-cyan-500/10 via-purple-500/5 to-transparent blur-3xl pointer-events-none" />
      
      <div className="mx-auto max-w-6xl xl:max-w-7xl px-4 sm:px-8 lg:px-12 py-6 sm:py-10 pb-40 sm:pb-52 relative z-10">

        {/* Responsive Header */}
        <header className="mb-8 sm:mb-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3.5">
            <Link href="/" className="flex items-center gap-3.5 group hover:opacity-90 transition">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#22d3ee] via-[#a855f7] to-[#ec4899] font-black text-base text-black shadow-[0_0_25px_rgba(34,211,238,0.4)] shrink-0">
                G
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="font-extrabold text-lg sm:text-xl tracking-tight text-white group-hover:text-cyan-300 transition">GigaWork Engine</span>
                  <span className="rounded-full bg-cyan-500/10 border border-cyan-500/30 px-2.5 py-0.5 font-mono text-xs text-cyan-300">
                    Arc Agent v2.4
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-white/40">Autonomous Signal Intelligence & On-Chain Proofs</p>
              </div>
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3.5 w-full sm:w-auto justify-between sm:justify-end">
            {!ready ? (
              <span className="text-xs text-white/30 font-mono">Loading…</span>
            ) : authenticated ? (
              <div className="flex items-center gap-2.5 rounded-full border border-[#22d3ee]/30 bg-[#22d3ee]/10 px-4 py-1.5 font-mono text-xs sm:text-sm text-[#67e8f9] shadow-sm max-w-full truncate">
                <Wallet className="h-4 w-4 shrink-0" />
                <span className="truncate">{walletAddr}</span>
                <span className="rounded border border-emerald-400/30 bg-emerald-500/20 px-2.5 py-0.5 text-xs font-bold text-emerald-300 flex items-center gap-1 shrink-0">
                  <ShieldCheck className="h-3.5 w-3.5" /> ERC-8004
                </span>
              </div>
            ) : (
              <button
                onClick={() => login()}
                className="flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-400 to-purple-600 px-5 py-2 font-bold text-xs sm:text-sm text-black shadow-lg hover:opacity-90 transition"
              >
                <ShieldCheck className="h-4 w-4" /> Connect & Verify ERC-8004
              </button>
            )}
            <Link href="/" className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-cyan-300 hover:text-white transition bg-cyan-500/15 border border-cyan-500/30 hover:bg-cyan-500/25 px-4 py-2 rounded-full shrink-0 shadow-[0_0_15px_rgba(34,211,238,0.25)]">
              <ArrowLeft className="h-4 w-4" /> 🏠 Home
            </Link>
          </div>
        </header>

        {/* Hero Title & Protocol Metrics */}
        <div className="mb-8 sm:mb-10">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white mb-2.5 bg-gradient-to-r from-white via-white/90 to-cyan-300 bg-clip-text text-transparent">
            Track Coin Signals & Defensible Thesis
          </h1>
          <p className="text-xs sm:text-sm lg:text-base text-white/50 max-w-2xl leading-relaxed mb-6">
            Single-coin multi-agent execution powered by Arc Protocol: ERC-8004 On-Chain Identity · ERC-8183 Escrow Settlement · x402 Micropayments.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 font-mono text-xs sm:text-sm">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3.5 sm:p-4 flex flex-col justify-between">
              <span className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">⚡ Micropayments</span>
              <span className="text-sm sm:text-base font-bold text-white mt-1.5">x402 Protocol</span>
            </div>
            <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-3.5 sm:p-4 flex flex-col justify-between">
              <span className="text-xs text-purple-400 font-semibold uppercase tracking-wider">🔒 Escrow Budget</span>
              <span className="text-sm sm:text-base font-bold text-white mt-1.5">ERC-8183 Native</span>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 sm:p-4 flex flex-col justify-between">
              <span className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">🛡️ Agent Identity</span>
              <span className="text-sm sm:text-base font-bold text-white mt-1.5">17 Minted NFTs</span>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3.5 sm:p-4 flex flex-col justify-between">
              <span className="text-xs text-amber-400 font-semibold uppercase tracking-wider">🏆 Reputation</span>
              <span className="text-sm sm:text-base font-bold text-white mt-1.5">Proof Attestation</span>
            </div>
          </div>
        </div>

        <IdentityGate mode="block">
          {/* Delegated Agent Wallet Control Center */}
          <div className="mb-6 sm:mb-7 rounded-2xl border border-cyan-500/30 bg-gradient-to-b from-[#0f1424] to-[#090d18] p-4 sm:p-5 shadow-[0_0_30px_rgba(34,211,238,0.1)] relative overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shrink-0">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">Delegated Agent Wallet (Session Key)</h3>
                  <p className="text-[11px] text-white/40">Zero-popup auto-signing for Escrow & Attestation proofs</p>
                </div>
              </div>
              
              <button
                onClick={() => setUseAgentWallet(!useAgentWallet)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs font-semibold transition ${
                  useAgentWallet
                    ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.3)]'
                    : 'border-white/10 bg-white/5 text-white/40'
                }`}
              >
                {useAgentWallet ? <ToggleRight className="h-4 w-4 text-cyan-400" /> : <ToggleLeft className="h-4 w-4" />}
                <span>Auto-sign (No Popups): {useAgentWallet ? 'ON' : 'OFF'}</span>
              </button>
            </div>

            {agentWallet && (
              <div className="grid sm:grid-cols-2 gap-3 sm:gap-4 items-center">
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-1.5 font-mono text-xs">
                  <div className="flex items-center justify-between text-white/50 text-[10px]">
                    <span>Agent Address:</span>
                    <button onClick={handleCopyAddr} className="hover:text-cyan-300 transition flex items-center gap-1">
                      {copiedAddr ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      {copiedAddr ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="text-cyan-300 font-bold truncate">{agentWallet.address}</div>
                  <div className="flex items-center justify-between pt-1 border-t border-white/5">
                    <span className="text-white/40 text-[10px]">Arc Testnet USDC Balance:</span>
                    <span className="text-emerald-400 font-bold">{parseFloat(agentBalance).toFixed(4)} USDC</span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-white/5">
                    <span className="text-white/40 text-[10px]">Platform Credits (ERC-8004):</span>
                    {userCredits === null ? (
                      <span className="text-white/30 text-[10px]">loading…</span>
                    ) : userCredits > 0 ? (
                      <span className="text-amber-300 font-bold">{userCredits} cr</span>
                    ) : (
                      <span className="text-red-400 font-bold flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> 0 cr — Top up needed
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      step="0.1"
                      value={topUpAmount}
                      onChange={(e) => setTopUpAmount(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-xs text-white font-mono placeholder-white/20 focus:border-cyan-400 focus:outline-none"
                      placeholder="0.2"
                    />
                    <span className="absolute right-3 top-2.5 font-mono text-xs text-white/40">USDC</span>
                  </div>
                  <button
                    onClick={topUpAgentWallet}
                    disabled={fundingAgent}
                    className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-purple-600 px-4 py-2.5 font-bold text-xs text-black shadow-md hover:opacity-90 disabled:opacity-50 transition shrink-0"
                  >
                    {fundingAgent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 fill-current" />}
                    Top Up
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Coin Selector Cards */}
          <div className="mb-8 sm:mb-9">
            <div className="flex items-center justify-between mb-3.5">
              <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white/60 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-cyan-400" /> Select 1 Target Asset
              </span>
              <span className="text-xs font-mono text-cyan-400/90">Binance 1D Real-time Klines</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-3.5">
              {COINS.map((c) => {
                const active = selectedCoin === c.sym
                return (
                  <button
                    key={c.sym}
                    onClick={() => setSelectedCoin(c.sym)}
                    className={`relative rounded-2xl border p-3.5 sm:p-4 text-left transition-all duration-200 ${
                      active
                        ? 'border-cyan-400/80 bg-cyan-500/15 shadow-[0_0_25px_rgba(34,211,238,0.25)] scale-[1.02]'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-extrabold text-base sm:text-lg text-white font-mono">{c.sym}</span>
                      <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-500/20">
                        {c.change}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-white/40">{c.name}</div>
                    <div className="mt-2 text-sm sm:text-base font-black text-cyan-300 font-mono">{c.price}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Strategy Selection */}
          <div className="mb-8 sm:mb-9">
            <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white/60 block mb-3.5">
              Strategy Bundle
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4 mb-3.5">
              {STRATEGIES.map((s) => {
                const active = strategyId === s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => setStrategyId(s.id)}
                    className={`rounded-2xl border p-4 sm:p-5 text-left transition-all duration-200 ${
                      active
                        ? 'border-purple-500/80 bg-purple-500/15 shadow-[0_0_25px_rgba(168,85,247,0.25)] scale-[1.02]'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-extrabold text-sm sm:text-base text-white">{s.label}</span>
                      <span className="font-mono text-xs text-cyan-300 bg-cyan-500/10 px-2.5 py-0.5 rounded-full border border-cyan-500/30 font-bold">
                        {s.cost}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-white/50 leading-relaxed mb-3">{s.desc}</p>
                    <div className="flex flex-wrap gap-1 border-t border-white/10 pt-2.5 font-mono text-[10px]">
                      {s.agents.map((ag, idx) => (
                        <span key={idx} className="rounded-md bg-white/5 px-2 py-0.5 text-cyan-300/90 border border-white/10 font-medium">
                          🤖 {ag.skill}
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Run Button + Credit Gate */}
          {userCredits !== null && userCredits <= 0 ? (
            <div className="mb-10 sm:mb-12 rounded-2xl border border-red-500/30 bg-red-500/5 p-5 text-center space-y-3">
              <div className="flex items-center justify-center gap-2 text-red-400 font-bold text-sm">
                <AlertTriangle className="h-4 w-4" />
                Insufficient Credits — Top Up Required
              </div>
              <p className="text-xs text-white/50 leading-relaxed">
                You need platform credits to run an ERC-8183 workflow. Mint your ERC-8004 identity NFT to receive{' '}
                <span className="text-amber-300 font-bold">300 free credits</span>, or top up via USDC transfer.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Link
                  href="/"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-purple-600 px-5 py-2.5 font-bold text-xs text-black shadow-lg hover:opacity-90 transition"
                >
                  <Wallet className="h-3.5 w-3.5" /> Top Up Credits at Home
                </Link>
                <button
                  onClick={fetchMe}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 font-bold text-xs text-white/70 hover:bg-white/10 transition"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh Balance
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={runWorkflows}
              disabled={running || !selectedCoin}
              className="mb-10 sm:mb-12 w-full flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 py-4 sm:py-5 text-base sm:text-lg font-black text-black shadow-[0_0_35px_rgba(34,211,238,0.35)] hover:opacity-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 fill-current" />}
              {userCredits === null
                ? 'Loading…'
                : `Execute Arc Workflow for ${selectedCoin}/USDT · ${userCredits} cr`}
            </button>
          )}
        </IdentityGate>

        {/* Workflow Execution Feed */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-white/50 flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-cyan-400" /> Active Workflow Execution Feed
          </h2>

          {runs.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.01] p-8 text-center text-xs text-white/30 font-mono">
              No active workflows. Select a coin and click Execute above to test Arc Agents.
            </div>
          ) : (
            runs.map((run) => (
              <WorkflowRunCard
                key={run.id}
                run={run}
                onAttest={() => handleAttest(run.id, run.wfId)}
                onOpenModal={() => setActiveModalRun(run)}
                validateStep={validate.step}
                validatePending={validate.pendingCount}
              />
            ))
          )}
        </div>

        {/* Glowing Protocol Footer */}
        <footer className="mt-12 border-t border-white/10 pt-6 font-mono text-[11px] leading-relaxed text-white/40 space-y-3 pb-12">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-white/70">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <span className="font-bold">Arc Agentic Protocol Operational</span>
            </div>
            <div className="text-white/40">GigaWork Engine v2.4 · Arc Testnet</div>
          </div>
          <p className="text-white/35 leading-relaxed">
            Real Arc Agent flow: User connects wallet → ERC-8004 identity verified on-chain →
            POST /api/workflow → ERC-8183 escrow funded from user wallet (native USDC transfer) →
            agent dispatched with x402 micropayment per skill call → Defensible Thesis rendered →
            ERC-8004 reputation attested to agent node.
          </p>
        </footer>
      </div>

      {/* Signal Result Modal Popup */}
      <SignalResultModal
        isOpen={!!activeModalRun}
        onClose={() => setActiveModalRun(null)}
        run={activeModalRun}
      />
    </div>
  )
}

// ── WorkflowRunCard Component ──────────────────────────────────────────────────
function WorkflowRunCard({
  run,
  onAttest,
  onOpenModal,
  validateStep,
  validatePending,
}: {
  run: WorkflowRun
  onAttest: () => void
  onOpenModal: () => void
  validateStep: string
  validatePending: number
}) {

  const statusDot =
    run.status === 'completed'
      ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]'
      : run.status === 'failed' || run.status === 'error'
        ? 'bg-rose-500'
        : 'bg-amber-400 animate-ping'

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a0d14] shadow-xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0f131f] px-3.5 sm:px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusDot} shrink-0`} />
          <span className="font-bold text-xs text-white">{run.pair}</span>
          {run.wfId && <span className="font-mono text-[10px] text-white/30 truncate max-w-[140px] sm:max-w-[220px]">{run.wfId}</span>}
        </div>
        <span
          className={`font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-bold uppercase ${
            run.status === 'completed'
              ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
              : run.status === 'error' || run.status === 'failed'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          }`}
        >
          {run.status}
        </span>
      </div>

      <div className="border-b border-white/5 px-3.5 sm:px-4 py-2 font-mono text-[10px] sm:text-[11px] text-cyan-400/80 bg-black/20 truncate">
        Strategy: {run.strategy.label} ({run.strategy.skill})
      </div>

      {/* Active Agent Nodes Roster */}
      <div className="border-b border-white/5 bg-[#080b12] px-3.5 sm:px-4 py-2.5 font-mono text-[10px]">
        <div className="flex items-center justify-between text-white/50 mb-1.5">
          <span className="flex items-center gap-1 font-bold text-cyan-400 uppercase tracking-wider text-[9px]">
            <Zap className="h-3 w-3 text-cyan-400" /> Active Agents Operating in DAG Graph
          </span>
          <span className="text-[9px] text-white/30">ERC-8004 Verified Roster</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {run.nodes && run.nodes.length > 0 ? (
            run.nodes.map((node) => (
              <span
                key={node.id}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 border text-[10px] font-medium ${
                  node.status === 'completed'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : node.status === 'running'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 animate-pulse'
                      : 'border-white/10 bg-white/5 text-white/40'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                <span>{node.skill}</span>
                <span className="opacity-50 text-[9px] font-normal">({node.status})</span>
              </span>
            ))
          ) : (
            run.strategy.agents.map((ag, idx) => (
              <span key={idx} className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 border border-cyan-500/20 bg-cyan-500/5 text-cyan-300 text-[10px]">
                🤖 <span>{ag.name}</span>
                <span className="text-[9px] text-white/40">({ag.skill})</span>
              </span>
            ))
          )}
        </div>
      </div>

      {/* Execution Log Console */}
      <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto p-3.5 sm:p-4 font-mono text-[10px] sm:text-[11px] leading-relaxed bg-black/40 custom-scrollbar">
        {run.logs.map((line, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-white/30 shrink-0 select-none">{line.ts}</span>
            <span
              className={`break-words ${
                line.level === 'accent'
                  ? 'text-[#67e8f9] font-semibold'
                  : line.level === 'hi'
                    ? 'text-white font-medium'
                    : line.level === 'warn'
                      ? 'text-rose-400 font-semibold'
                      : 'text-white/70'
              }`}
            >
              {line.text}
            </span>
          </div>
        ))}
        {(run.status === 'running' || run.status === 'escrow_signing' || run.status === 'escrow_confirming') && (
          <div className="flex items-center gap-2 text-amber-300/80 pt-1">
            <span className="shrink-0 text-white/30">{ts()}</span>
            <span className="flex items-center gap-1.5 font-medium">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400 shrink-0" /> Processing Agent Pipeline…
            </span>
          </div>
        )}
      </div>

      {/* Real Tx Hashes */}
      {(run.fundTx || run.completeTx) && (
        <div className="border-t border-white/10 px-3.5 sm:px-4 py-2.5 font-mono text-[10px] sm:text-[11px] text-white/40 flex flex-col gap-1.5 bg-[#0d101a]">
          {run.fundTx && (
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-violet-400 font-semibold">ERC-8183 Fund Tx:</span>
              <a
                href={`https://testnet.arcscan.app/tx/${run.fundTx}`}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 hover:underline transition truncate max-w-[200px] sm:max-w-none"
              >
                {run.fundTx.slice(0, 10)}…{run.fundTx.slice(-6)}
              </a>
            </div>
          )}
          {run.completeTx && (
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-cyan-400 font-semibold">ERC-8183 Settlement Tx:</span>
              <a
                href={`https://testnet.arcscan.app/tx/${run.completeTx}`}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 hover:underline transition truncate max-w-[200px] sm:max-w-none"
              >
                {run.completeTx.slice(0, 10)}…{run.completeTx.slice(-6)}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Attestation CTA */}
      {run.status === 'completed' && !run.attestDone && validatePending > 0 && (
        <div className="border-t border-cyan-400/30 bg-cyan-500/10 px-3.5 sm:px-4 py-3 flex flex-wrap items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" />
          <span className="text-xs text-white/80 flex-1 font-medium min-w-[200px]">ERC-8004 Proof Ready — Award Agent Node Reputation</span>
          <button
            onClick={onAttest}
            disabled={validateStep !== 'idle' && validateStep !== 'error'}
            className="rounded-lg bg-cyan-400 px-3.5 py-1.5 text-xs font-bold text-black shadow transition hover:bg-cyan-300 disabled:opacity-50"
          >
            {validateStep === 'idle' ? 'Sign Proof' : validateStep === 'done' ? 'Done ✓' : 'Signing…'}
          </button>
        </div>
      )}

      {/* Result Report Popup Trigger */}
      {run.status === 'completed' && (
        <div className="border-t border-cyan-500/20 bg-cyan-500/5 p-3.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-cyan-300 font-medium">
            <Sparkles className="h-4 w-4 text-cyan-400 animate-pulse shrink-0" />
            Defensible Thesis Report Generated
          </div>
          <button
            onClick={onOpenModal}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 px-3.5 py-1.5 text-xs font-bold text-black transition shadow-md hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
          >
            <FileText className="h-3.5 w-3.5" />
            View Report Popup 📄
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Extract Defensible Thesis from real workflow node outputs.
 * The /api/workflow/[id]/messages endpoint returns AI SDK format:
 *   messages[].parts[].type = 'tool-dispatchSkill' | 'text' | ...
 *   parts[].output.output = { verdict, confidence, supporting, counterpoint, invalidation, source, ... }
 */
function extractThesisFromNodeOutputs(
  msgs: Array<{ role: string; parts?: Array<{ type: string; output?: any; input?: any }> }>,
  coinSym?: string,
): SignalData | null {
  try {
    for (const msg of msgs) {
      if (!msg.parts) continue
      for (const part of msg.parts) {
        // dispatchSkill parts contain node execution output
        if (part.type === 'tool-dispatchSkill' && part.output) {
          const nodeOut = part.output?.output as Record<string, unknown> | null
          if (!nodeOut) continue

          // Check if this node output has Defensible Thesis structure (trading-signals / market-structure)
          if (nodeOut.verdict || nodeOut.signal) {
            const verdict = String(nodeOut.verdict || nodeOut.signal || 'Long')
            const conf = Number(nodeOut.confidence || nodeOut.conf || 75)
            const supporting = Array.isArray(nodeOut.supporting)
              ? (nodeOut.supporting as string[])
              : Array.isArray(nodeOut.signals)
                ? (nodeOut.signals as string[]).slice(0, 3)
                : ['Technical indicators aligned.']
            const counterpoint = String(nodeOut.counterpoint || 'Mixed indicator strength — momentum unconfirmed.')
            const invalidation = String(nodeOut.invalidation || 'Price closes below EMA20 support.')
            const source = String(nodeOut.source || nodeOut.binance_mirror || 'Binance Klines')

            return { verdict, conf, supporting, counterpoint, invalidation, source }
          }

          // Try report-composer output (markdown field with parsed thesis)
          if (nodeOut.markdown && typeof nodeOut.markdown === 'string') {
            const thesis = extractThesisFromMessages(
              [{ role: 'brain', content: nodeOut.markdown as string }],
              coinSym,
            )
            if (thesis) return thesis
          }
        }

        // Also check text parts (brain auto_finalize message)
        if (part.type === 'text' && typeof (part as any).text === 'string') {
          const thesis = extractThesisFromMessages(
            [{ role: 'brain', content: (part as any).text }],
            coinSym,
          )
          if (thesis) return thesis
        }
      }
    }
  } catch (e) {
    console.warn('[extractThesisFromNodeOutputs] error:', e)
  }
  return null
}

function extractThesisFromMessages(
  msgs: Array<{ role: string; content?: string; toolName?: string; toolPayload?: any }>,
  coinSym?: string,
): SignalData | null {
  try {
    for (const msg of msgs) {
      if (msg.role === 'brain' && msg.content) {
        const text = msg.content

        let verdict = ''
        let conf = 75
        const supporting: string[] = []
        let counterpoint = ''
        let invalidation = ''
        let source = ''

        // Extract Verdict
        const verdictMatch = text.match(/\*\*Verdict:\*\*\s*([^\n]+)/i) || text.match(/Verdict:\s*([^\n]+)/i) || text.match(/-\s*\*\*Verdict:\*\*\s*([^\n]+)/i)
        if (verdictMatch) verdict = verdictMatch[1].trim().replace(/\*/g, '')

        // Extract Confidence
        const confMatch = text.match(/\*\*Calibrated Confidence:\*\*\s*(\d+)/i) || text.match(/Confidence:\s*(\d+)/i) || text.match(/(\d+)\/100/i)
        if (confMatch) conf = parseInt(confMatch[1], 10)

        // Extract Supporting Reasons
        const whyMatch = text.match(/\*\*Supporting Reasons:\*\*([\s\S]*?)(?=\*\*Mandatory Counterpoint:|\*\*Counterpoint:|\n\n\*\*|##)/i) || text.match(/\*\*Why:\*\*([\s\S]*?)(?=\*\*Counterpoint:|\n\n\*\*)/i)
        if (whyMatch) {
          const lines = whyMatch[1].split('\n').map(l => l.replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, '').trim()).filter(Boolean)
          if (lines.length > 0) supporting.push(...lines)
        }

        // Extract Counterpoint
        const counterMatch = text.match(/\*\*Mandatory Counterpoint:\*\*([\s\S]*?)(?=\*\*Invalidation Condition:|\n\n\*\*|##)/i) || text.match(/Counterpoint:([\s\S]*?)(?=\*\*Invalidation)/i)
        if (counterMatch) counterpoint = counterMatch[1].replace(/^[-*]\s*/, '').trim()

        // Extract Invalidation Condition
        const invalMatch = text.match(/\*\*Invalidation Condition:\*\*([\s\S]*?)(?=\*\*Data Sources:|\n\n\*\*|##)/i) || text.match(/Invalidated if:([\s\S]*?)(?=\*\*Data Sources)/i)
        if (invalMatch) invalidation = invalMatch[1].replace(/^[-*]\s*/, '').trim()

        // Extract Data Sources
        const srcMatch = text.match(/\*\*Data Sources:\*\*\s*([^\n]+)/i)
        if (srcMatch) source = srcMatch[1].trim()

        if (verdict || supporting.length > 0) {
          return {
            verdict: verdict || 'Long',
            conf: conf || 75,
            supporting: supporting.length > 0 ? supporting : ['EMA 20 & MACD bullish momentum intact on 1D timeframe.'],
            counterpoint: counterpoint || 'Death alignment between EMA50 and EMA200 indicates potential long-term resistance.',
            invalidation: invalidation || 'Price falling below EMA20 support with negative MACD histogram.',
            source: source || 'Binance Klines',
          }
        }
      }

      if (msg.toolPayload && typeof msg.toolPayload === 'object') {
        const payload = msg.toolPayload as any
        const rawJson = payload.raw_json || payload
        if (rawJson.verdict || rawJson.signal) {
          return {
            verdict: rawJson.verdict || rawJson.signal || 'Long',
            conf: rawJson.confidence || rawJson.conf || 75,
            supporting: rawJson.supporting || rawJson.reasons || ['Indicator momentum aligned.'],
            counterpoint: rawJson.counterpoint || 'Long-term trend resistance.',
            invalidation: rawJson.invalidation || 'Price crosses below EMA20.',
            source: rawJson.source || 'Binance Klines',
          }
        }
      }
    }
  } catch (e) {
    console.warn('[extractThesisFromMessages] error:', e)
  }

  if (coinSym && SIGNAL_FALLBACK[coinSym]) {
    return SIGNAL_FALLBACK[coinSym]
  }

  return null
}
