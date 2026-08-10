'use client'

/**
 * Billing — the vault surface.
 *
 * This was a command console: you typed `topup 5` and `ls` at a prompt.
 * Handling real money that way is hostile, so it is now a normal page —
 * a balance card, a deposit form, a swap panel and a ledger table.
 *
 * Every figure comes from the server. The balance is the reconciled
 * on-chain vault balance from /api/me, the ledger rows are real deposits
 * and real x402 spends, and swap quotes come from /api/appkit rather than
 * being computed here. Nothing on this page is estimated locally.
 *
 * Two different wallets are in play, and the copy says which is which:
 * the DEPOSIT moves USDC from the connected wallet into the server-held
 * vault that pays agents, while the SWAP happens entirely in the
 * connected wallet and never touches the vault.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownUp,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Wallet,
} from 'lucide-react'

import { useSwap, type SwapToken } from '@/lib/hooks/useSwap'
import { useTopup } from '@/lib/hooks/useTopup'
import { useWalletTokens } from '@/lib/hooks/useWalletTokens'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

/** Tokens routable on Arc Testnet — mirrors useSwap's address map. */
const TOKENS: SwapToken[] = ['USDC', 'USYC', 'EURC', 'cirBTC']
type Token = SwapToken

const PRESETS = [1, 5, 10, 25]

interface LedgerRow {
  id: string
  amountUsdc: number
  kind: 'topup' | 'spend'
  label: string
  txHash: string | null
  createdAt: string
}

interface Me {
  usdcBalance: number
  dedicatedVaultAddress: string | null
}

function Card({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <section className="gwt-panel">
      <div className="gwt-panel-bar">
        <span>{title}</span>
        {sub && <span className="text-white/25">{sub}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function BillingConsole() {
  const [me, setMe] = useState<Me | null>(null)
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const topup = useTopup()
  const [amount, setAmount] = useState('5')

  const load = useCallback(async () => {
    const [m, l] = await Promise.all([
      fetch('/api/me', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/me/ledger', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
    if (m && typeof m.usdcBalance === 'number') {
      setMe({ usdcBalance: m.usdcBalance, dedicatedVaultAddress: m.dedicatedVaultAddress ?? null })
    }
    // The route returns `{ ledger: [...] }` — verified against
    // app/api/me/ledger/route.ts, not guessed.
    if (l) setLedger(l.ledger ?? [])
  }, [])

  useEffect(() => {
    void load()
    const on = () => void load()
    window.addEventListener('gw:credits-changed', on)
    return () => window.removeEventListener('gw:credits-changed', on)
  }, [load])

  const topupBusy = ['signing', 'confirming', 'granting'].includes(topup.step)
  const amountNum = parseFloat(amount)
  const amountValid = Number.isFinite(amountNum) && amountNum > 0

  const runTopup = async () => {
    if (!amountValid || topupBusy) return
    await topup.topup(amountNum)
    void load()
  }

  // ── Swap ────────────────────────────────────────────────────────
  const [tokenIn, setTokenIn] = useState<Token>('USDC')
  const [tokenOut, setTokenOut] = useState<Token>('USYC')
  const [swapAmount, setSwapAmount] = useState('1')
  const [quote, setQuote] = useState<string | null>(null)
  /** null = unknown; false = the API echoed an assumption, not a real quote. */
  const [quoted, setQuoted] = useState<boolean | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [swapMsg, setSwapMsg] = useState<{ kind: 'ok' | 'err'; text: string; tx?: string } | null>(
    null,
  )

  const swapper = useSwap()
  const purse = useWalletTokens()
  const swapNum = parseFloat(swapAmount)
  // Quoting needs only a sane pair; executing also needs a wallet to sign
  // and enough of the input token to actually send. Letting the button
  // through on an overdraft just moves the failure into the wallet popup.
  const held = purse.tokens.find((x) => x.symbol === tokenIn)
  const overdraft = !!held?.ok && Number.isFinite(swapNum) && swapNum > held.amount
  const pairValid = Number.isFinite(swapNum) && swapNum > 0 && tokenIn !== tokenOut
  const swapValid = pairValid && swapper.connected && !overdraft

  // Quotes only. The swap itself is signed by the connected wallet in
  // useSwap — the server never holds a key for this action.
  const quoteSwap = useCallback(async () => {
    const r = await fetch('/api/appkit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'estimateSwap', amount: swapAmount, tokenIn, tokenOut }),
    })
    const j = await r.json().catch(() => ({}) as Record<string, unknown>)
    if (!r.ok) throw new Error(String(j.detail ?? j.error ?? `HTTP ${r.status}`))
    return j as Record<string, unknown>
  }, [swapAmount, tokenIn, tokenOut])

  // Re-quote whenever the pair or amount changes. Debounced so typing an
  // amount doesn't fire a request per keystroke.
  useEffect(() => {
    if (!pairValid) {
      setQuote(null)
      return
    }
    let alive = true
    setQuoting(true)
    const t = setTimeout(() => {
      quoteSwap()
        .then((j) => {
          if (!alive) return
          // `estimatedOutput` is what /api/appkit actually returns.
          setQuote(j.estimatedOutput == null ? null : String(j.estimatedOutput))
          setQuoted(j.quoted === false ? false : true)
        })
        .catch(() => alive && setQuote(null))
        .finally(() => alive && setQuoting(false))
    }, 400)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [pairValid, quoteSwap])

  const runSwap = async () => {
    if (!swapValid || swapping) return
    setSwapping(true)
    setSwapMsg(null)
    try {
      const { txHash } = await swapper.swap(tokenIn, tokenOut, swapAmount)
      setSwapMsg({
        kind: 'ok',
        text: `Swapped ${swapAmount} ${tokenIn} → ${tokenOut}`,
        tx: txHash ?? undefined,
      })
      void load()
    } catch (e) {
      setSwapMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSwapping(false)
    }
  }

  const spent = useMemo(
    () => (ledger ?? []).filter((r) => r.kind === 'spend').reduce((s, r) => s + Math.abs(r.amountUsdc), 0),
    [ledger],
  )
  const deposited = useMemo(
    () => (ledger ?? []).filter((r) => r.kind === 'topup').reduce((s, r) => s + Math.abs(r.amountUsdc), 0),
    [ledger],
  )

  return (
    <main className="gwt-page">
      <div className="gwt-wrap space-y-4">
        {/* ── Balance ───────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Vault</div>
            <div className="mt-1 text-[34px] font-bold leading-none tabular-nums text-white">
              {me ? `$${me.usdcBalance.toFixed(2)}` : '—'}
              <span className="ml-2 text-[13px] font-medium text-white/35">USDC</span>
            </div>
          </div>
          <button
            className="gwt-token"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              await load()
              setRefreshing(false)
            }}
          >
            <RefreshCw size={11} className={refreshing ? 'gwt-spin' : ''} /> refresh
          </button>
        </div>

        {me?.dedicatedVaultAddress && (
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-white/40">
            <span>Your vault address</span>
            <code className="gwt-addr">{me.dedicatedVaultAddress}</code>
            <button
              className="gwt-token"
              onClick={() => {
                navigator.clipboard.writeText(me.dedicatedVaultAddress!)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'copied' : 'copy'}
            </button>
            <a
              className="gwt-token"
              href={`${EXPLORER}/address/${me.dedicatedVaultAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={11} /> explorer
            </a>
          </div>
        )}

        {/* ── Connected wallet ──────────────────────────────────
             A second, separate balance. Deposits come OUT of here and
             swaps happen INSIDE here — neither touches the vault above,
             so the page has to show both or the swap panel is asking for
             an amount the user cannot see. */}
        <section className="gwt-panel">
          <div className="gwt-panel-bar">
            <span>connected wallet · what you can swap</span>
            {purse.address ? (
              <span className="flex items-center gap-2">
                <a
                  className="gwt-addr"
                  href={`${EXPLORER}/address/${purse.address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {purse.address.slice(0, 8)}…{purse.address.slice(-6)}
                </a>
                <button className="gwt-token" disabled={purse.loading} onClick={purse.refresh}>
                  <RefreshCw size={11} className={purse.loading ? 'gwt-spin' : ''} />
                </button>
              </span>
            ) : (
              <span className="text-white/25">not connected</span>
            )}
          </div>
          <div className="p-3">
            {!purse.address ? (
              <div className="text-[12px] text-white/30">
                Connect a wallet to see its balances. This is the wallet that signs swaps and funds
                deposits — it is not the same wallet as the vault above.
              </div>
            ) : (
              <div className="gwt-purse">
                <div className="gwt-purse-cell">
                  <div className="gwt-purse-v">
                    {purse.native === null ? '—' : purse.native.toFixed(4)}
                  </div>
                  <div className="gwt-purse-k">native · gas</div>
                </div>
                {purse.tokens.map((t) => (
                  <div key={t.symbol} className="gwt-purse-cell">
                    <div className={`gwt-purse-v ${t.ok ? '' : 'text-white/25'}`}>
                      {t.ok ? (t.amount === 0 ? '0' : t.amount.toFixed(t.amount < 1 ? 6 : 2)) : '?'}
                    </div>
                    <div className="gwt-purse-k">
                      {t.symbol}
                      {!t.ok && ' · unreadable'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="gwt-stats">
          {/* These two are sums over the ledger window the API returns (the
              most recent 50 deposits and 100 spends), NOT lifetime totals —
              so they are labelled as such. Left unqualified they would not
              reconcile against the balance and would read as a bug. */}
          <div className="gwt-stat">
            <div className="gwt-stat-v">${deposited.toFixed(2)}</div>
            <div className="gwt-stat-k">deposits shown</div>
          </div>
          <div className="gwt-stat">
            <div className="gwt-stat-v">${spent.toFixed(2)}</div>
            <div className="gwt-stat-k">agent spend shown</div>
          </div>
          <div className="gwt-stat">
            <div className="gwt-stat-v">{ledger ? ledger.length : '—'}</div>
            <div className="gwt-stat-k">entries shown</div>
          </div>
          <div className="gwt-stat">
            <div className="gwt-stat-v">{me ? `$${me.usdcBalance.toFixed(2)}` : '—'}</div>
            <div className="gwt-stat-k">spendable now</div>
          </div>
        </div>

        <div className="gwt-proto">
          {/* ── Deposit ─────────────────────────────────────────── */}
          <Card title="Deposit USDC" sub="from your connected wallet">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  className="gwt-token"
                  data-on={amount === String(p) ? '1' : '0'}
                  onClick={() => setAmount(String(p))}
                >
                  ${p}
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="text-white/30">$</span>
              <input
                className="gwt-input flex-1"
                inputMode="decimal"
                value={amount}
                disabled={topupBusy}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="5.00"
              />
              <button className="gwt-btn" disabled={!amountValid || topupBusy} onClick={runTopup}>
                {topupBusy ? (
                  <>
                    <Loader2 size={13} className="gwt-spin" />
                    {topup.step === 'signing'
                      ? 'Check your wallet…'
                      : topup.step === 'confirming'
                        ? 'Confirming…'
                        : 'Crediting…'}
                  </>
                ) : (
                  <>
                    <Wallet size={13} /> Deposit
                  </>
                )}
              </button>
            </div>

            <p className="mt-2.5 text-[11.5px] leading-relaxed text-white/35">
              Sends USDC from the wallet you connected to your vault, then credits the ledger once
              the transfer is confirmed on-chain. Your wallet will ask you to approve it.
            </p>

            {topup.error && <p className="mt-2 text-[11.5px] text-[var(--gw-rose)]">{topup.error}</p>}
            {topup.step === 'done' && topup.result && (
              <p className="mt-2 text-[11.5px] text-[var(--gw-emerald)]">
                Credited ${topup.result.grantedUsdc.toFixed(2)} — balance $
                {topup.result.balanceUsdc.toFixed(2)}
                {topup.txHash && (
                  <a
                    className="ml-2 text-[var(--gw-cyan)] hover:underline"
                    href={`${EXPLORER}/tx/${topup.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ↗ tx
                  </a>
                )}
              </p>
            )}
          </Card>

          {/* ── Swap ────────────────────────────────────────────── */}
          <Card title="Swap" sub="Arc Testnet · signed by your wallet">
            <div className="flex items-center gap-2">
              <select
                className="gwt-input"
                value={tokenIn}
                onChange={(e) => setTokenIn(e.target.value as Token)}
              >
                {TOKENS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                className="gwt-token"
                title="Flip"
                onClick={() => {
                  setTokenIn(tokenOut)
                  setTokenOut(tokenIn)
                }}
              >
                <ArrowDownUp size={12} />
              </button>
              <select
                className="gwt-input"
                value={tokenOut}
                onChange={(e) => setTokenOut(e.target.value as Token)}
              >
                {TOKENS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                className="gwt-input flex-1"
                inputMode="decimal"
                value={swapAmount}
                disabled={swapping}
                onChange={(e) => setSwapAmount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="1.00"
              />
              {held?.ok && held.amount > 0 && (
                <button
                  className="gwt-token"
                  onClick={() => setSwapAmount(String(held.amount))}
                  title={`Use your full ${tokenIn} balance`}
                >
                  max
                </button>
              )}
              <button className="gwt-btn" disabled={!swapValid || swapping} onClick={runSwap}>
                {swapping ? (
                  <>
                    <Loader2 size={13} className="gwt-spin" />
                    {swapper.stage === 'approving'
                      ? 'Approve in wallet…'
                      : swapper.stage === 'signing'
                        ? 'Sign in wallet…'
                        : 'Confirming…'}
                  </>
                ) : (
                  <>
                    <ArrowDownUp size={13} /> Swap
                  </>
                )}
              </button>
            </div>

            <div className="mt-2.5 text-[11.5px] text-white/40">
              {tokenIn === tokenOut ? (
                <span className="text-[var(--gw-amber)]">Pick two different tokens.</span>
              ) : !swapper.connected ? (
                <span className="text-[var(--gw-amber)]">
                  Connect a wallet to swap — the transaction is signed by your wallet, not by the
                  server.
                </span>
              ) : overdraft ? (
                <span className="text-[var(--gw-rose)]">
                  Your wallet holds {held?.amount} {tokenIn} — less than you are trying to swap.
                </span>
              ) : quoting ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={11} className="gwt-spin" /> quoting…
                </span>
              ) : quote ? (
                <>
                  Estimated out{' '}
                  <span className="font-semibold text-white/75">
                    {quote} {tokenOut}
                  </span>{' '}
                  {/* The USYC path does not query anything — the API echoes
                      the input on a 1:1 assumption and now says so via
                      `quoted:false`. Claiming "quoted by the router" for
                      that was simply untrue. */}
                  {quoted === false
                    ? '— assumed 1:1, not a quote. The Teller sets the real rate on execution.'
                    : '— quoted by the router, not by this page.'}
                </>
              ) : (
                'No quote available for this pair right now.'
              )}
            </div>

            {swapMsg && (
              <p
                className={`mt-2 text-[11.5px] ${
                  swapMsg.kind === 'ok' ? 'text-[var(--gw-emerald)]' : 'text-[var(--gw-rose)]'
                }`}
              >
                {swapMsg.text}
                {swapMsg.tx && (
                  <a
                    className="ml-2 text-[var(--gw-cyan)] hover:underline"
                    href={`${EXPLORER}/tx/${swapMsg.tx}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ↗ tx
                  </a>
                )}
              </p>
            )}
          </Card>
        </div>

        {/* ── Ledger ────────────────────────────────────────────── */}
        <div className="gwt-h">Ledger</div>
        <p className="-mt-1 mb-2 text-[11.5px] text-white/30">
          Most recent 50 deposits and 100 agent payments. Older entries exist on-chain but are not
          listed here, so the totals above will not always reconcile against the balance.
        </p>
        <div className="gwt-panel overflow-x-auto p-3">
          {ledger === null ? (
            <div className="text-[12px] text-white/30">loading…</div>
          ) : ledger.length === 0 ? (
            <div className="text-[12px] text-white/30">
              Nothing yet — deposit above to fund your first run.
            </div>
          ) : (
            <table className="gwt-list">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Entry</th>
                  <th className="text-right">Amount</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-white/35">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="text-white/70">{r.label}</td>
                    <td
                      className={`text-right tabular-nums ${
                        r.kind === 'topup' ? 'text-[var(--gw-emerald)]' : 'text-white/60'
                      }`}
                    >
                      {r.kind === 'topup' ? '+' : '−'}${Math.abs(r.amountUsdc).toFixed(2)}
                    </td>
                    <td>
                      {r.txHash ? (
                        <a
                          className="gwt-addr"
                          href={`${EXPLORER}/tx/${r.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.txHash.slice(0, 10)}…
                        </a>
                      ) : (
                        <span className="text-white/20">off-chain</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  )
}
