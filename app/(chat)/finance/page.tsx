'use client'

/**
 * /finance — App-kit panel cho top-up + activity.
 *
 * Tab 1 "Top-up" — Mua credit thật bằng USDC trên Arc Testnet:
 *   - Form $USDC + presets, rate flat 100 cr/USDC
 *   - useTopup() → ký USDC.transfer → /api/me/topup verify → grant
 *   - Stepper 3 bước (sign → confirm → server verify)
 *
 * Tab 2 "Activity" — credit ledger thật từ /api/me/ledger
 *   - Filter theo loại (top-up / dispatch / grant / all)
 *   - Mỗi row có link explorer nếu có tx_hash, link workflow nếu có
 */
import { useEffect, useMemo, useState } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { ArrowLeft, ArrowRight, ArrowUpDown, CheckCircle2, Coins, ExternalLink, Loader2, Plus, Repeat2 } from 'lucide-react'
import Link from 'next/link'

import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'
import { useTopup, type TopupStep } from '@/lib/hooks/useTopup'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { useTokenBalance } from '@/lib/hooks/useTokenBalance'
import { createWalletClient, custom, parseUnits, createPublicClient, http, encodeFunctionData, maxUint256, type Hex } from 'viem'

const PRESETS = [3, 5, 10, 25]
const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

const STEP_LABELS: Record<TopupStep, string> = {
  idle: 'Ready',
  signing: 'Signing USDC.transfer in wallet…',
  confirming: 'Waiting for on-chain confirmation…',
  granting: 'Server verifying + crediting…',
  done: '✓ Credits added',
  error: '✗ Error',
}

type Me = { id: string; wallet: string; credits: number }
type LedgerRow = {
  id: string
  delta: number
  reason: string
  workflowId: string | null
  txHash: string | null
  createdAt: string
}

type RateInfo = {
  rate: number
  treasury: string
  usdcAddress: string
  usdcDecimals: number
}

type FinanceTab = 'topup' | 'swap' | 'bridge' | 'activity' | 'escrows'

const TAB_CONFIG: { key: FinanceTab; label: string }[] = [
  { key: 'topup', label: 'Top-up' },
  { key: 'swap', label: 'Swap' },
  { key: 'bridge', label: 'Bridge' },
  { key: 'activity', label: 'Activity' },
  { key: 'escrows', label: 'Escrows' },
]

export default function FinancePage() {
  const [tab, setTab] = useState<FinanceTab>('topup')

  return (
    <div className="giga-theme flex h-full w-full flex-col">
      <MainHeader />
      <div className="flex flex-1 overflow-hidden">
        <HistorySidebar />
        <AppRail />
        <main className="flex-1 overflow-y-auto bg-[#0f131c] p-4 sm:p-8">
          <div className="mx-auto w-full max-w-3xl">
            {/* Header */}
            <div className="mb-6 flex items-center gap-3">
              <Link
                href="/"
                className="inline-flex h-8 w-8 items-center justify-center border-2 border-black bg-[var(--giga-panel)] text-white/70 hover:text-white"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <h1 className="font-pixel-header text-xl text-white sm:text-2xl">
                Finance
              </h1>
            </div>

            {/* Tabs */}
            <div className="mb-4 inline-flex flex-wrap border-2 border-black bg-[var(--giga-panel)] p-0.5">
              {TAB_CONFIG.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-1.5 text-sm font-medium transition ${
                    tab === key
                      ? 'bg-[var(--giga-accent)] text-black'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'topup' && <TopupTab />}
            {tab === 'swap' && <SwapTab />}
            {tab === 'bridge' && <BridgeTab />}
            {tab === 'activity' && <ActivityTab />}
            {tab === 'escrows' && <EscrowsTab />}
          </div>
        </main>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// TOP-UP TAB
// ════════════════════════════════════════════════════════════════
function TopupTab() {
  const { user } = usePrivy()
  const wallet = user?.wallet?.address ?? null
  const usdcBalance = useUSDCBalance(wallet)

  const [me, setMe] = useState<Me | null>(null)
  const [rate, setRate] = useState<RateInfo | null>(null)
  const [usdc, setUsdc] = useState(5)

  const refresh = () =>
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setMe(j))
      .catch(() => {})

  useEffect(() => {
    refresh()
    fetch('/api/me/topup')
      .then((r) => r.json())
      .then(setRate)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const onBust = () => refresh()
    window.addEventListener('gw:credits-changed', onBust)
    return () => window.removeEventListener('gw:credits-changed', onBust)
  }, [])

  const r = rate?.rate ?? 100
  const credits = Math.round(usdc * r)

  const { step, error, txHash, result, reset, topup } = useTopup()
  const busy = step === 'signing' || step === 'confirming' || step === 'granting'
  const isDone = step === 'done' && result
  const decimals = rate?.usdcDecimals ?? 6
  const divisor = BigInt(10) ** BigInt(decimals)
  const usdcWhole = Number(usdcBalance.raw / divisor)
  const insufficient = !usdcBalance.loading && usdcWhole < usdc

  return (
    <div className="space-y-4">
      {/* Balances summary */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="On-chain USDC"
          value={usdcBalance.loading ? '…' : usdcBalance.formatted}
          unit="USDC"
          tone="blue"
          hint={wallet ? wallet.slice(0, 8) + '…' + wallet.slice(-4) : '—'}
        />
        <StatCard
          label="Current credits"
          value={me?.credits ?? '—'}
          unit="credits"
          tone="cyan"
          hint={me ? `≈ $${(me.credits / 100).toFixed(2)} USDC` : ''}
        />
      </div>

      {/* Form / Done banner */}
      <div className="border-2 border-black bg-[var(--giga-panel)] p-4 sm:p-6">
        {isDone ? (
          <div className="flex flex-col gap-3 text-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center bg-emerald-500/15 text-emerald-300">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div className="text-base text-white">
              +<span className="font-mono text-emerald-300">{result!.granted}</span> credits added
            </div>
            <div className="text-xs text-white/65">
              New balance: {result!.balance} credits · Paid {result!.usdcAmount} USDC ({result!.rate} cr/USDC)
            </div>
            <a
              href={result!.explorer}
              target="_blank"
              rel="noreferrer"
              className="mx-auto inline-flex items-center gap-1 text-sm text-cyan-300 hover:text-cyan-200"
            >
              View tx on ArcScan <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button
              onClick={reset}
              className="mx-auto mt-2 inline-flex items-center gap-1 border-2 border-black bg-[var(--giga-accent)] px-4 py-1.5 text-sm font-bold text-black hover:bg-yellow-300"
            >
              <Plus className="h-3.5 w-3.5" />
              Top up again
            </button>
          </div>
        ) : (
          <>
            <div className="mb-3 text-xs uppercase tracking-wider text-white/55">
              Buy credits · 1 USDC = {r} credits · treasury{' '}
              <span className="font-mono text-white/70">
                {rate?.treasury?.slice(0, 6) ?? '0x…'}…{rate?.treasury?.slice(-4) ?? ''}
              </span>
            </div>

            <div className="mb-3 grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  disabled={busy}
                  onClick={() => setUsdc(p)}
                  className={`border-2 border-black px-2 py-2 text-sm transition disabled:opacity-40 ${
                    usdc === p
                      ? 'bg-[var(--giga-accent)] text-black'
                      : 'bg-[#1f1f33] text-white/75 hover:bg-[#27273f]'
                  }`}
                >
                  ${p}
                  <div className="text-xs opacity-70">{p * r} cr</div>
                </button>
              ))}
            </div>

            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs uppercase tracking-wider text-white/55">
                Custom USDC amount (1 - 1000)
              </label>
              <div className="flex items-center gap-2 text-xs text-white/55">
                <span>Bal: {usdcBalance.loading ? '…' : usdcBalance.formatted}</span>
                <button
                  onClick={() => {
                    const maxWhole = Math.floor(usdcWhole)
                    if (maxWhole > 0) setUsdc(Math.min(maxWhole, 1000))
                  }}
                  disabled={busy || usdcBalance.loading || usdcWhole < 1}
                  className="font-semibold text-cyan-300 hover:text-cyan-200 disabled:opacity-50"
                >
                  Max
                </button>
              </div>
            </div>
            <div className="mb-3 flex items-center gap-2 border-2 border-black bg-[#1f1f33] px-3 py-2">
              <span className="text-white/55">$</span>
              <input
                type="number"
                min={1}
                max={1000}
                step={1}
                value={usdc}
                disabled={busy}
                onChange={(e) => setUsdc(Number(e.target.value) || 1)}
                className="flex-1 bg-transparent text-base outline-none"
              />
              <span className="text-xs text-white/45">USDC</span>
            </div>

            <div className="mb-4 flex items-center justify-between border-2 border-cyan-400/30 bg-cyan-400/[0.05] px-3 py-2 text-sm">
              <span className="text-white/65">You will receive</span>
              <span>
                <span className="font-mono text-cyan-200">+{credits}</span>
                <span className="ml-1 text-white/55">credits</span>
              </span>
            </div>

            {/* Stepper while running */}
            {step !== 'idle' && step !== 'error' && (
              <div className="mb-3 border-2 border-cyan-400/30 bg-cyan-400/[0.05] p-3">
                <div className="mb-2 text-xs uppercase tracking-wider text-cyan-300/85">
                  Progress
                </div>
                <StepDot label="Sign USDC.transfer in wallet" active={step === 'signing'} done={['confirming', 'granting', 'done'].includes(step)} />
                <StepDot label="Wait for on-chain confirmation" active={step === 'confirming'} done={['granting', 'done'].includes(step)} />
                <StepDot label="Server verify + credit account" active={step === 'granting'} done={step === 'done'} />
                {txHash && (
                  <div className="mt-2 truncate font-mono text-xs text-cyan-200/70">
                    {txHash}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mb-3 border-2 border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            {insufficient && (
              <div className="mb-3 border-2 border-amber-400/40 bg-amber-400/[0.08] px-3 py-2 text-sm text-amber-200">
                Wallet has insufficient USDC on Arc Testnet (~{usdcBalance.formatted} available). Use the
                testnet faucet or bridge more.
              </div>
            )}

            <button
              onClick={() => topup(usdc)}
              disabled={busy || insufficient || !wallet}
              className="inline-flex w-full items-center justify-center gap-1.5 border-2 border-black bg-[var(--giga-accent)] px-3 py-2.5 text-sm font-bold text-black transition hover:bg-yellow-300 disabled:opacity-40"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {STEP_LABELS[step]}
                </>
              ) : (
                <>
                  <Coins className="h-3.5 w-3.5" />
                  Buy {credits} credits ({usdc} USDC)
                </>
              )}
            </button>
          </>
        )}
      </div>

      <p className="text-xs text-white/40">
        Top-up calls <code className="text-white/55">USDC.transfer({rate?.treasury?.slice(0, 6)}…)</code> from
        your wallet. The server reads the receipt and Transfer event to verify before crediting your
        account. Each tx_hash can only be claimed once.
      </p>
    </div>
  )
}

function StatCard({
  label,
  value,
  unit,
  tone,
  hint,
}: {
  label: string
  value: string | number
  unit: string
  tone: 'blue' | 'cyan'
  hint?: string
}) {
  const toneCls =
    tone === 'blue'
      ? 'text-blue-200'
      : 'text-cyan-200'
  return (
    <div className="border-2 border-black bg-[var(--giga-panel)] p-3">
      <div className="text-xs uppercase tracking-wider text-white/55">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`font-mono text-2xl ${toneCls}`}>{value}</span>
        <span className="text-xs text-white/45">{unit}</span>
      </div>
      {hint && <div className="mt-0.5 truncate font-mono text-xs text-white/40">{hint}</div>}
    </div>
  )
}

function StepDot({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span
        className={`inline-flex h-4 w-4 items-center justify-center border-2 ${
          done
            ? 'border-emerald-400 bg-emerald-500/30 text-emerald-200'
            : active
            ? 'border-cyan-400 bg-cyan-400/30 text-cyan-200'
            : 'border-white/20 bg-white/5 text-white/40'
        }`}
      >
        {done ? '✓' : active ? '●' : '○'}
      </span>
      <span className={done ? 'text-emerald-200' : active ? 'text-cyan-200' : 'text-white/55'}>
        {label}
      </span>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// ACTIVITY TAB
// ════════════════════════════════════════════════════════════════
type Filter = 'all' | 'topup' | 'dispatch' | 'grant'

function ActivityTab() {
  const [rows, setRows] = useState<LedgerRow[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    fetch('/api/me/ledger')
      .then((r) => r.json())
      .then((j: { ledger: LedgerRow[] }) => setRows(j.ledger ?? []))
      .catch(() => setRows([]))
  }, [])

  useEffect(() => {
    const onBust = () =>
      fetch('/api/me/ledger')
        .then((r) => r.json())
        .then((j: { ledger: LedgerRow[] }) => setRows(j.ledger ?? []))
        .catch(() => {})
    window.addEventListener('gw:credits-changed', onBust)
    return () => window.removeEventListener('gw:credits-changed', onBust)
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    if (filter === 'all') return rows
    return rows.filter((r) => bucketOf(r) === filter)
  }, [rows, filter])

  if (rows === null) {
    return (
      <div className="flex items-center justify-center border-2 border-black bg-[var(--giga-panel)] py-16 text-white/55">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading ledger…
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="border-2 border-black bg-[var(--giga-panel)] py-12 text-center text-white/55">
        No activity yet. <Link href="/" className="text-cyan-300 hover:text-cyan-200">Create your first workflow</Link> →
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'topup', 'dispatch', 'grant'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`border-2 border-black px-3 py-1 text-xs uppercase tracking-wider transition ${
              filter === f
                ? 'bg-[var(--giga-accent)] text-black'
                : 'bg-[#1f1f33] text-white/65 hover:bg-[#27273f]'
            }`}
          >
            {f === 'all' ? `All (${rows.length})` : f}
          </button>
        ))}
      </div>

      <div className="border-2 border-black bg-[var(--giga-panel)]">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-white/45">
            No "{filter}" activity.
          </div>
        )}
        {filtered.map((row, i) => (
          <ActivityRow key={row.id} row={row} isLast={i === filtered.length - 1} />
        ))}
      </div>
    </div>
  )
}

function bucketOf(row: LedgerRow): Filter {
  if (row.reason.startsWith('topup')) return 'topup'
  if (row.reason.startsWith('dispatch')) return 'dispatch'
  if (row.reason.includes('grant') || row.reason === 'signup_grant') return 'grant'
  return 'all'
}

function ActivityRow({ row, isLast }: { row: LedgerRow; isLast: boolean }) {
  const positive = row.delta > 0
  const ts = new Date(row.createdAt)
  const label = humanReason(row.reason)
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${!isLast ? 'border-b border-white/10' : ''}`}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-black bg-[#1f1f33] text-base">
        {iconFor(row.reason)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm text-white">
          <span className="font-medium">{label}</span>
          {row.workflowId && (
            <Link
              href={`/workflow/${row.workflowId}`}
              className="inline-flex items-center gap-0.5 text-xs text-cyan-300/80 hover:text-cyan-200"
            >
              workflow <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-white/45">
          <span>
            {ts.toLocaleDateString()} · {ts.toLocaleTimeString()}
          </span>
          {row.txHash && (
            <a
              href={`${EXPLORER}/tx/${row.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-cyan-300/70 hover:text-cyan-200"
            >
              {row.txHash.slice(0, 8)}…{row.txHash.slice(-4)} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      <div
        className={`shrink-0 font-mono text-base ${
          positive ? 'text-emerald-300' : 'text-red-300'
        }`}
      >
        {positive ? '+' : ''}
        {row.delta}
      </div>
    </div>
  )
}

function humanReason(reason: string): string {
  if (reason === 'signup_grant') return 'Welcome bonus'
  if (reason === 'topup_onchain') return 'Buy credits (USDC)'
  if (reason === 'topup_admin') return 'Admin grant'
  if (reason === 'topup_surge') return 'Top-up (surge legacy)'
  if (reason.startsWith('dispatch:')) return `Dispatch · ${reason.slice('dispatch:'.length)}`
  return reason
}

function iconFor(reason: string): string {
  if (reason.startsWith('topup')) return '🪙'
  if (reason.startsWith('dispatch')) return '⚡'
  if (reason.includes('grant')) return '🎁'
  return '•'
}

// ════════════════════════════════════════════════════════════════
// ESCROWS TAB — list ERC-8183 jobs scoped to the current user
// ════════════════════════════════════════════════════════════════
type EscrowRow = {
  workflowId: string
  prompt: string
  status: string
  createdAt: string
  jobId: string
  budgetUsdc: string | null
  createTx: string | null
  setBudgetTx: string | null
  approveTx: string | null
  fundTx: string | null
  submitTx: string | null
  completeTx: string | null
  // Lifecycle stage derived from which tx hashes are populated
  stage: 'created' | 'set' | 'approved' | 'funded' | 'submitted' | 'completed'
}

function EscrowsTab() {
  const [rows, setRows] = useState<EscrowRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/me/escrows', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j?.detail || j?.error || `${r.status}`)
        }
        return r.json() as Promise<{ escrows: EscrowRow[] }>
      })
      .then((j) => setRows(j.escrows))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])

  if (err) {
    return (
      <div className="border-2 border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
        Failed to load escrows: {err}
      </div>
    )
  }
  if (rows == null) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/55">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="border-2 border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/55">
        No ERC-8183 escrows yet. Create a workflow on the home page to open your first job.
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <EscrowRowCard key={row.workflowId} row={row} />
      ))}
    </div>
  )
}

const STAGE_LABELS: Record<EscrowRow['stage'], { text: string; color: string }> = {
  created:   { text: 'Created',   color: 'text-white/55' },
  set:       { text: 'Budget set', color: 'text-cyan-300' },
  approved:  { text: 'Approved',  color: 'text-cyan-300' },
  funded:    { text: 'Funded',    color: 'text-emerald-300' },
  submitted: { text: 'Submitted', color: 'text-yellow-300' },
  completed: { text: 'Completed', color: 'text-emerald-400' },
}

function EscrowRowCard({ row }: { row: EscrowRow }) {
  const stage = STAGE_LABELS[row.stage]
  return (
    <div className="border-2 border-black bg-[var(--giga-panel)] p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={`/workflow/${row.workflowId}`}
          className="font-mono text-xs text-emerald-300 hover:underline"
        >
          job #{row.jobId}
        </Link>
        <span className={`text-[11px] uppercase tracking-wider ${stage.color}`}>
          {stage.text}
        </span>
        {row.budgetUsdc && (
          <span className="ml-auto font-mono text-xs text-cyan-300">
            {row.budgetUsdc} USDC
          </span>
        )}
      </div>
      <p className="mb-2 line-clamp-2 break-words text-[13px] text-white/85">
        {row.prompt}
      </p>
      <div className="flex flex-wrap gap-2 text-[10px]">
        <TxChip label="open" tx={row.createTx} />
        <TxChip label="set" tx={row.setBudgetTx} />
        <TxChip label="apr" tx={row.approveTx} />
        <TxChip label="fund" tx={row.fundTx} />
        <TxChip label="sub" tx={row.submitTx} />
        <TxChip label="done" tx={row.completeTx} />
      </div>
    </div>
  )
}

function TxChip({ label, tx }: { label: string; tx: string | null }) {
  if (tx === '0x0') {
    return (
      <span className="border border-white/10 px-1.5 py-0.5 font-mono text-white/35">
        {label}: allowance
      </span>
    )
  }
  if (!tx) {
    return (
      <span className="border border-white/10 px-1.5 py-0.5 text-white/30">
        {label}: —
      </span>
    )
  }
  return (
    <a
      href={`${EXPLORER}/tx/${tx}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-300 hover:bg-emerald-500/20"
    >
      {label}: {tx.slice(0, 6)}…{tx.slice(-4)}
      <ExternalLink className="h-2 w-2 opacity-70" />
    </a>
  )
}

// ════════════════════════════════════════════════════════════════
// SWAP TAB — USDC ↔ EURC on Arc Testnet via App-Kit (v1 pattern)
// ════════════════════════════════════════════════════════════════
const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC ?? 'https://rpc.drpc.testnet.arc.network'
const ARC_USDC = process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000'

const ARC_TOKENS: Record<string, string> = {
  USDC: ARC_USDC,
  USYC: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C', // Token
  EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
}

const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USYC: 6,
  EURC: 6,
  cirBTC: 8,
}

const SWAP_TOKENS = [
  { symbol: 'USDC', name: 'USD Coin' },
  { symbol: 'USYC', name: 'Hashnote USYC' },
  { symbol: 'EURC', name: 'Euro Coin' },
  { symbol: 'cirBTC', name: 'cirBTC' },
]

function SwapTab() {
  const { user } = usePrivy()
  const { wallets } = useWallets()
  const wallet = user?.wallet?.address ?? null

  const [tokenIn, setTokenIn] = useState('USDC')
  const [tokenOut, setTokenOut] = useState('EURC')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [estimatedOut, setEstimatedOut] = useState<string | null>(null)
  const [estimating, setEstimating] = useState(false)

  const balanceIn = useTokenBalance(wallet, ARC_TOKENS[tokenIn], ARC_RPC, TOKEN_DECIMALS[tokenIn] ?? 6)
  const balanceOut = useTokenBalance(wallet, ARC_TOKENS[tokenOut], ARC_RPC, TOKEN_DECIMALS[tokenOut] ?? 6)

  const swapDirection = () => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setEstimatedOut(null)
  }

  // Debounced estimate
  useEffect(() => {
    setEstimatedOut(null)
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return
    let cancelled = false
    const t = setTimeout(async () => {
      setEstimating(true)
      try {
        const r = await fetch('/api/appkit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'estimateSwap', amount, tokenIn, tokenOut }),
        })
        const j = await r.json()
        if (!cancelled && j.ok) {
          setEstimatedOut(j.estimatedOutput ?? null)
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setEstimating(false) }
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [amount, tokenIn, tokenOut])

  const rate = amount && estimatedOut && parseFloat(amount) > 0
    ? (parseFloat(estimatedOut) / parseFloat(amount)).toFixed(4) : null

  const execute = async () => {
    setBusy(true); setError(null); setResult(null)
    try {
      const isUSYC = tokenIn === 'USYC' || tokenOut === 'USYC'

      if (isUSYC) {
        // --- USYC Swap via Frontend Wallet (Teller Contract) ---
        const walletObj = wallets[0]
        if (!walletObj) throw new Error('No connected wallet')

        // Switch to Arc Testnet
        const ARC_CHAIN_ID = 5042002
        try { await walletObj.switchChain(ARC_CHAIN_ID) } catch { /* ignore */ }

        const provider = await walletObj.getEthereumProvider()
        const walletClient = createWalletClient({ transport: custom(provider) })
        const publicClient = createPublicClient({ chain: { id: ARC_CHAIN_ID } as any, transport: http(ARC_RPC) })
        
        const TELLER = '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A' as `0x${string}`
        const decimals = 6
        const amountWei = parseUnits(amount, decimals)
        const accountAddr = walletObj.address as `0x${string}`

        const ERC20_ABI = [
          { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
          { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
        ] as const

        const TELLER_ABI = [
          { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_assets', type: 'uint256' }, { name: '_receiver', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
          { name: 'redeem', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_shares', type: 'uint256' }, { name: '_receiver', type: 'address' }, { name: '_account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
        ] as const

        if (tokenIn === 'USDC' && tokenOut === 'USYC') {
          // Check allowance
          const allowance = await publicClient.readContract({
            address: ARC_TOKENS.USDC as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [accountAddr, TELLER],
          })
          if ((allowance as bigint) < amountWei) {
            const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [TELLER, maxUint256] })
            const hash = await walletClient.sendTransaction({ account: accountAddr, to: ARC_TOKENS.USDC as `0x${string}`, data, chain: null })
            await publicClient.waitForTransactionReceipt({ hash })
          }

          // Simulate deposit to catch Allowlist errors early
          try {
            await publicClient.simulateContract({
              account: accountAddr,
              address: TELLER,
              abi: TELLER_ABI,
              functionName: 'deposit',
              args: [amountWei, accountAddr],
            })
          } catch (simError: any) {
            throw new Error('Simulation failed. Your wallet may not be allowlisted by Circle for USYC: ' + (simError.shortMessage || simError.message))
          }

          const data = encodeFunctionData({ abi: TELLER_ABI, functionName: 'deposit', args: [amountWei, accountAddr] })
          const hash = await walletClient.sendTransaction({ account: accountAddr, to: TELLER, data, chain: null })
          setResult({ ok: true, amountIn: amount, tokenIn, amountOut: amount, tokenOut, txHash: hash, explorerUrl: `https://testnet.arcscan.app/tx/${hash}` })
          
        } else if (tokenIn === 'USYC' && tokenOut === 'USDC') {
          // Check allowance
          const allowance = await publicClient.readContract({
            address: ARC_TOKENS.USYC as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [accountAddr, TELLER],
          })
          if ((allowance as bigint) < amountWei) {
            const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [TELLER, maxUint256] })
            const hash = await walletClient.sendTransaction({ account: accountAddr, to: ARC_TOKENS.USYC as `0x${string}`, data, chain: null })
            await publicClient.waitForTransactionReceipt({ hash })
          }

          // Simulate redeem to catch Allowlist errors early
          try {
            await publicClient.simulateContract({
              account: accountAddr,
              address: TELLER,
              abi: TELLER_ABI,
              functionName: 'redeem',
              args: [amountWei, accountAddr, accountAddr],
            })
          } catch (simError: any) {
            throw new Error('Simulation failed. Your wallet may not be allowlisted by Circle for USYC: ' + (simError.shortMessage || simError.message))
          }

          const data = encodeFunctionData({ abi: TELLER_ABI, functionName: 'redeem', args: [amountWei, accountAddr, accountAddr] })
          const hash = await walletClient.sendTransaction({ account: accountAddr, to: TELLER, data, chain: null })
          setResult({ ok: true, amountIn: amount, tokenIn, amountOut: amount, tokenOut, txHash: hash, explorerUrl: `https://testnet.arcscan.app/tx/${hash}` })
        } else {
          throw new Error('USYC can only be swapped with USDC.')
        }

      } else {
        // --- Regular App-Kit Swap (USDC ↔ EURC) — user ký trực tiếp ---
        const walletObj = wallets[0]
        if (!walletObj) throw new Error('Chưa kết nối ví. Vui lòng kết nối ví trước.')

        let kitKey = process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY
        if (!kitKey) {
          try {
            const res = await fetch('/api/appkit')
            if (res.ok) {
              const data = await res.json()
              if (data.kitKey) {
                kitKey = data.kitKey
              }
            }
          } catch (e) {
            console.error('Failed to fetch CIRCLE_KIT_KEY from server:', e)
          }
        }
        if (!kitKey) throw new Error('CIRCLE_KIT_KEY chưa được cấu hình (Vui lòng cấu hình CIRCLE_KIT_KEY hoặc NEXT_PUBLIC_CIRCLE_KIT_KEY trên Vercel).')

        // Switch sang Arc Testnet trước khi swap
        try { await walletObj.switchChain(5042002) } catch { /* ignore */ }

        const provider = await walletObj.getEthereumProvider()

        const { AppKit } = await import('@circle-fin/app-kit')
        const { createViemAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2')

        const kit = new AppKit()
        const adapter = await createViemAdapterFromProvider({ provider: provider as any })

        // Map symbol → contract address
        const TOKEN_MAP: Record<string, string> = {
          USDC: ARC_TOKENS.USDC,
          EURC: ARC_TOKENS.EURC,
          cirBTC: ARC_TOKENS.cirBTC,
        }
        const resolvedIn  = TOKEN_MAP[tokenIn]  ?? tokenIn
        const resolvedOut = TOKEN_MAP[tokenOut] ?? tokenOut

        const swapResult = await (kit as any).swap({
          from: { adapter, chain: 'Arc_Testnet' as any },
          tokenIn:  resolvedIn  as any,
          tokenOut: resolvedOut as any,
          amountIn: amount,
          config: { kitKey, slippageBps: 100 },
        })

        const normalizeAmt = (v: unknown): string | null => {
          if (v == null) return null
          if (typeof v === 'string' || typeof v === 'number') return String(v)
          if (typeof v === 'object' && 'amount' in (v as any)) return String((v as any).amount)
          return null
        }

        setResult({
          ok: true,
          action: 'swap',
          tokenIn,
          tokenOut,
          amountIn: amount,
          amountOut: normalizeAmt((swapResult as any).amountOut),
          txHash: (swapResult as any).txHash ?? null,
          explorerUrl: (swapResult as any).explorerUrl ?? null,
          fees: (swapResult as any).fees ?? [],
        })
      }


      setAmount('')
      setEstimatedOut(null)
      window.dispatchEvent(new Event('gw:credits-changed'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Swap failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="border-2 border-black bg-[var(--giga-panel)] p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Repeat2 className="h-5 w-5 text-emerald-300" />
          <h3 className="text-sm font-bold text-white">Swap on Arc Testnet</h3>
          <span className="ml-auto rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">Arc App-Kit</span>
        </div>

        {/* ── You Pay ─────────────── */}
        <div className="mb-1 rounded border-2 border-white/10 bg-[#1f1f33] p-3 transition-colors focus-within:border-emerald-500/50">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-white/55">
            <span>You Pay</span>
            <div className="flex items-center gap-2">
              <span>Bal: {balanceIn.loading ? '…' : balanceIn.formatted}</span>
              <button
                onClick={() => { if (!balanceIn.loading && balanceIn.raw > BigInt(0)) setAmount(balanceIn.formatted) }}
                disabled={busy || balanceIn.loading || balanceIn.raw === BigInt(0)}
                className="font-bold text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
              >MAX</button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select value={tokenIn} onChange={(e) => { setTokenIn(e.target.value); if (e.target.value === tokenOut) setTokenOut(tokenIn) }}
              disabled={busy} className="bg-transparent text-xl font-bold text-white outline-none cursor-pointer">
              {SWAP_TOKENS.map(t => <option key={t.symbol} value={t.symbol} className="bg-[#1f1f33]">{t.symbol}</option>)}
            </select>
            <input type="number" min="0.01" step="0.01" value={amount} disabled={busy}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 bg-transparent text-right text-2xl font-mono text-white outline-none placeholder:text-white/20" placeholder="0.00" />
          </div>
        </div>

        {/* ── Swap arrow ─────────── */}
        <div className="relative z-10 -my-5 flex justify-center">
          <button onClick={swapDirection} disabled={busy}
            className="flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-[var(--giga-panel)] bg-[#1f1f33] text-white transition hover:bg-[#27273f] hover:text-emerald-300 disabled:opacity-50">
            <ArrowUpDown className="h-4 w-4" />
          </button>
        </div>

        {/* ── You Receive ────────── */}
        <div className="mb-4 rounded border-2 border-white/10 bg-[#1f1f33] p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-white/55">
            <span>You Receive</span>
            <span>Bal: {balanceOut.loading ? '…' : balanceOut.formatted}</span>
          </div>
          <div className="flex items-center gap-3">
            <select value={tokenOut} onChange={(e) => { setTokenOut(e.target.value); if (e.target.value === tokenIn) setTokenIn(tokenOut) }}
              disabled={busy} className="bg-transparent text-xl font-bold text-white outline-none cursor-pointer">
              {SWAP_TOKENS.map(t => <option key={t.symbol} value={t.symbol} className="bg-[#1f1f33]">{t.symbol}</option>)}
            </select>
            <span className="flex-1 text-right text-2xl font-mono text-white/50">
              {estimating ? '…' : estimatedOut ?? '—'}
            </span>
          </div>
        </div>

        {/* ── Rate info ──────────── */}
        {amount && parseFloat(amount) > 0 && (
          <div className="mb-4 rounded border-2 border-white/10 bg-[#1f1f33]/50 p-3 space-y-1">
            {rate && (
              <div className="flex justify-between text-xs"><span className="text-white/55">Rate</span>
                <span className="text-white">1 {tokenIn} = {rate} {tokenOut}</span></div>
            )}
            <div className="flex justify-between text-xs"><span className="text-white/55">Slippage</span>
              <span className="text-white">1.0%</span></div>
            <div className="flex justify-between text-xs"><span className="text-white/55">Network</span>
              <span className="text-emerald-300">Arc Testnet</span></div>
          </div>
        )}

        {result && (
          <div className="mb-4 border-2 border-emerald-400/30 bg-emerald-500/10 p-3">
            <div className="mb-1 text-sm text-emerald-200">✓ Swapped {result.amountIn} {result.tokenIn} → {result.amountOut ?? '?'} {result.tokenOut}</div>
            {result.explorerUrl && (
              <a href={result.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200">
                View on ArcScan <ExternalLink className="h-3 w-3" /></a>
            )}
          </div>
        )}

        {error && <div className="mb-4 border-2 border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

        {/* USYC note */}
        {(tokenIn === 'USYC' || tokenOut === 'USYC') && (
          <div className="mb-3 rounded border-2 border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300/80">
            USYC uses the <span className="font-bold">Teller contract</span> (approve + deposit/redeem).
            Wallet must be allowlisted by Circle.
          </div>
        )}

        <button onClick={execute} disabled={busy || !amount || Number(amount) <= 0 || tokenIn === tokenOut}
          className="inline-flex w-full items-center justify-center gap-1.5 border-2 border-black bg-emerald-500 px-3 py-3 text-sm font-bold text-black transition hover:bg-emerald-400 disabled:opacity-40">
          {busy ? (<><Loader2 className="h-4 w-4 animate-spin" />Swapping…</>) : `Swap ${tokenIn} → ${tokenOut}`}
        </button>
      </div>

      <p className="text-[10px] text-center text-white/40">USDC/EURC via App Kit · USYC via Teller Contract · Arc Testnet</p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// BRIDGE TAB — Sepolia → Arc Testnet via App-Kit CCTP (v1 pattern)
// ════════════════════════════════════════════════════════════════
const ALCHEMY_KEY = 'cxzxMQobCJKW1pAWWsPPW'
const BRIDGE_SOURCES = [
  { value: 'Arc_Testnet', label: 'Arc Testnet', rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC ?? 'https://arc-testnet.g.alchemy.com/v2/cxzxMQobCJKW1pAWWsPPW', usdc: '0x3600000000000000000000000000000000000000' },
  { value: 'Ethereum_Sepolia', label: 'ETH Sepolia', rpcUrl: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  { value: 'Base_Sepolia', label: 'Base Sepolia', rpcUrl: `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
]

type BridgeEstimate = { feeTotal: number; providerFee: number; forwarderFee: number; kitFee: number; amountReceived: number }

function BridgeTab() {
  const { user } = usePrivy()
  const wallet = user?.wallet?.address ?? null

  const [fromChain, setFromChain] = useState('Ethereum_Sepolia')
  const [toChain, setToChain] = useState('Arc_Testnet')
  const source = BRIDGE_SOURCES.find((s) => s.value === fromChain)!
  const dest = BRIDGE_SOURCES.find((s) => s.value === toChain)!
  const balance = useTokenBalance(wallet, source.usdc, source.rpcUrl)

  const [amount, setAmount] = useState('')
  const [speed, setSpeed] = useState<'FAST' | 'SLOW'>('FAST')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState('')

  // Fee estimate
  const [estimate, setEstimate] = useState<BridgeEstimate | null>(null)
  const [estimating, setEstimating] = useState(false)

  const parsedAmount = parseFloat(amount) || 0
  const MIN_BRIDGE = 1.0
  const FEE_BUFFER = 0.10
  const belowMin = parsedAmount > 0 && parsedAmount < MIN_BRIDGE
  const exceedsBal = balance.raw > BigInt(0) && parsedAmount > parseFloat(balance.formatted)
  const maxSpendable = balance.raw > BigInt(0) ? Math.max(0, parseFloat(balance.formatted) - FEE_BUFFER) : 0

  // Debounced fee estimate
  useEffect(() => {
    setEstimate(null)
    if (!parsedAmount || parsedAmount < MIN_BRIDGE) return
    let cancelled = false
    const t = setTimeout(async () => {
      setEstimating(true)
      try {
        const r = await fetch('/api/appkit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'estimateBridge', amount, fromChain, toChain, speed }),
        })
        const j = await r.json()
        if (!cancelled && j.ok) {
          setEstimate({ feeTotal: j.feeTotal, providerFee: j.providerFee, forwarderFee: j.forwarderFee, kitFee: j.kitFee, amountReceived: j.amountReceived })
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setEstimating(false) }
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [parsedAmount, fromChain, toChain, speed, amount])

  const execute = async () => {
    setBusy(true); setError(null); setResult(null); setStep('Initiating bridge...')
    try {
      const r = await fetch('/api/appkit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bridge', amount, fromChain, toChain, speed }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setResult(j)
      setAmount('')
      window.dispatchEvent(new Event('gw:credits-changed'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bridge failed')
    } finally { setBusy(false); setStep('') }
  }

  return (
    <div className="space-y-4">
      <div className="border-2 border-black bg-[var(--giga-panel)] p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <ArrowRight className="h-5 w-5 text-cyan-300" />
          <h3 className="text-sm font-bold text-white">Bridge USDC to Arc Testnet</h3>
          <span className="ml-auto rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300">CCTP</span>
        </div>

        {/* Source chain */}
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs uppercase tracking-wider text-white/55">From</label>
          <div className="text-[10px] text-white/45">Bal: {balance.loading ? '…' : balance.formatted}</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {BRIDGE_SOURCES.map((s) => (
            <button key={`from-${s.value}`} disabled={busy || s.value === toChain} onClick={() => setFromChain(s.value)}
              className={`border-2 border-black px-1 py-2 text-[11px] font-bold transition disabled:opacity-40 ${
                fromChain === s.value ? 'bg-cyan-500/20 text-cyan-300' : 'bg-[#1f1f33] text-white/75 hover:bg-[#27273f]'
              }`}>{s.label}</button>
          ))}
        </div>

        {/* Swap direction */}
        <div className="my-3 flex justify-center">
          <button onClick={() => { const t = fromChain; setFromChain(toChain); setToChain(t) }} disabled={busy}
            className="rounded-full border-2 border-black bg-[#1f1f33] p-1.5 text-cyan-500 transition hover:bg-[#27273f] active:scale-95 disabled:opacity-50">
            <ArrowUpDown className="h-4 w-4" />
          </button>
        </div>

        {/* Destination chain */}
        <label className="mb-1 block text-xs uppercase tracking-wider text-white/55">To</label>
        <div className="mb-3 grid grid-cols-3 gap-2">
          {BRIDGE_SOURCES.map((s) => (
            <button key={`to-${s.value}`} disabled={busy || s.value === fromChain} onClick={() => setToChain(s.value)}
              className={`border-2 border-black px-1 py-2 text-[11px] font-bold transition disabled:opacity-40 ${
                toChain === s.value ? 'bg-cyan-500/20 text-cyan-300' : 'bg-[#1f1f33] text-white/75 hover:bg-[#27273f]'
              }`}>{s.label}</button>
          ))}
        </div>

        {/* Amount */}
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs uppercase tracking-wider text-white/55">Amount (USDC)</label>
          <div className="flex items-center gap-2 text-xs text-white/55">
            <button onClick={() => { if (maxSpendable >= MIN_BRIDGE) setAmount(maxSpendable.toFixed(2)) }}
              disabled={busy || balance.loading || maxSpendable < MIN_BRIDGE}
              className="font-bold text-cyan-300 hover:text-cyan-200 disabled:opacity-50">MAX</button>
          </div>
        </div>
        <div className="mb-3 flex items-center gap-2 border-2 border-black bg-[#1f1f33] px-3 py-2">
          <span className="text-white/55">$</span>
          <input type="number" min="1" step="0.01" value={amount} disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1 bg-transparent text-base outline-none placeholder:text-white/20" placeholder="0.00" />
          <span className="text-xs text-white/45">USDC</span>
        </div>

        {/* Speed toggle */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button onClick={() => setSpeed('FAST')} disabled={busy}
            className={`border-2 border-black px-2 py-2 text-xs transition ${speed === 'FAST' ? 'bg-cyan-500/20 text-cyan-300' : 'bg-[#1f1f33] text-white/55 hover:bg-[#27273f]'}`}>
            <div className="font-bold">Fast</div><div className="text-[10px] text-white/40">~15 sec · CCTP v2</div>
          </button>
          <button onClick={() => setSpeed('SLOW')} disabled={busy}
            className={`border-2 border-black px-2 py-2 text-xs transition ${speed === 'SLOW' ? 'bg-cyan-500/20 text-cyan-300' : 'bg-[#1f1f33] text-white/55 hover:bg-[#27273f]'}`}>
            <div className="font-bold">Standard</div><div className="text-[10px] text-white/40">~15 min · lower fee</div>
          </button>
        </div>

        {/* Route */}
        <div className="mb-3 flex items-center gap-3 border-2 border-cyan-400/20 bg-cyan-400/[0.04] px-3 py-2 text-xs">
          <span className="font-mono text-cyan-200">{source.label}</span>
          <span className="text-white/40">→</span>
          <span className="font-mono text-cyan-200">{dest.label}</span>
          {parsedAmount > 0 && <span className="ml-auto text-white/45">~{parsedAmount.toFixed(2)} USDC</span>}
        </div>

        {/* Fee estimate */}
        {parsedAmount >= MIN_BRIDGE && (
          <div className="mb-3 rounded border-2 border-white/10 bg-[#1f1f33]/50 p-3 space-y-1 text-xs">
            {belowMin ? (
              <div className="text-amber-400">Min bridge: {MIN_BRIDGE} USDC</div>
            ) : exceedsBal ? (
              <div className="text-red-400">Insufficient balance ({balance.formatted} USDC on {source.label})</div>
            ) : estimating ? (
              <div className="flex items-center gap-2 text-white/55"><Loader2 className="h-3 w-3 animate-spin" />Estimating fees...</div>
            ) : estimate ? (
              <>
                <div className="flex justify-between"><span className="text-white/55">Bridge amount</span><span className="text-white">{parsedAmount.toFixed(2)} USDC</span></div>
                {estimate.providerFee > 0 && <div className="flex justify-between"><span className="text-white/55">CCTP fee</span><span className="text-red-300">~{estimate.providerFee.toFixed(4)}</span></div>}
                {estimate.forwarderFee > 0 && <div className="flex justify-between"><span className="text-white/55">Forwarder fee</span><span className="text-red-300">~{estimate.forwarderFee.toFixed(4)}</span></div>}
                <div className="flex justify-between border-t border-white/10 pt-1"><span className="text-white/55">You receive</span><span className="font-bold text-cyan-300">~{estimate.amountReceived.toFixed(4)} USDC</span></div>
              </>
            ) : null}
          </div>
        )}

        {/* Step progress */}
        {step && (
          <div className="mb-3 flex items-center gap-2 border-2 border-white/10 bg-[#1f1f33] px-3 py-2 text-xs text-white/55">
            <Loader2 className="h-3 w-3 animate-spin text-cyan-300" />{step}
          </div>
        )}

        {result && (
          <div className="mb-3 border-2 border-emerald-400/30 bg-emerald-500/10 p-3">
            <div className="mb-1 text-sm text-emerald-200">✓ Bridged {result.amount} USDC → {dest.label}</div>
            {result.txHash && (
              <a href={result.explorerUrl || `https://testnet.arcscan.app/tx/${result.txHash}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200">
                View on ArcScan <ExternalLink className="h-3 w-3" /></a>
            )}
          </div>
        )}

        {error && <div className="mb-3 border-2 border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

        <button onClick={execute} disabled={busy || !amount || parsedAmount < MIN_BRIDGE || exceedsBal}
          className="inline-flex w-full items-center justify-center gap-1.5 border-2 border-black bg-cyan-500 px-3 py-3 text-sm font-bold text-black transition hover:bg-cyan-400 disabled:opacity-40">
          {busy ? (<><Loader2 className="h-4 w-4 animate-spin" />Bridging…</>) : exceedsBal ? 'Insufficient Balance' : belowMin ? `Min ${MIN_BRIDGE} USDC` : 'Bridge via Circle CCTP'}
        </button>
      </div>

      <p className="text-[10px] text-center text-white/40">Powered by Arc App Kit & Circle CCTP v2</p>
    </div>
  )
}
