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
import { usePrivy } from '@privy-io/react-auth'
import { ArrowLeft, ArrowRight, CheckCircle2, Coins, ExternalLink, Loader2, Plus } from 'lucide-react'
import Link from 'next/link'

import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'
import { useTopup, type TopupStep } from '@/lib/hooks/useTopup'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'

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

export default function FinancePage() {
  const [tab, setTab] = useState<'topup' | 'activity'>('topup')

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
            <div className="mb-4 inline-flex border-2 border-black bg-[var(--giga-panel)] p-0.5">
              {(['topup', 'activity'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 text-sm font-medium transition ${
                    tab === t
                      ? 'bg-[var(--giga-accent)] text-black'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  {t === 'topup' ? 'Top-up' : 'Activity'}
                </button>
              ))}
            </div>

            {tab === 'topup' ? <TopupTab /> : <ActivityTab />}
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

            <label className="mb-1 block text-xs uppercase tracking-wider text-white/55">
              Custom USDC amount (1 - 1000)
            </label>
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
  if (reason === 'topup_onchain') return 'Mua credit (USDC)'
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
