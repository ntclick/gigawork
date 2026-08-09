'use client'

/**
 * BillingConsole — vault balance, address, and real money movement.
 *
 * Two balances are shown separately and never summed: the vault balance
 * (spendable — what actually pays agents) and the connected wallet's
 * on-chain USDC (what you can deposit FROM). Conflating them is what the
 * old finance page did.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'

import { LogStream } from '@/components/console/LogStream'
import { PromptInput } from '@/components/console/PromptInput'
import { useTopup } from '@/lib/hooks/useTopup'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import type { ConsoleLine } from '@/lib/workflow/consoleLog'

interface LedgerEntry {
  id: string
  amountUsdc: number
  kind: 'topup' | 'spend'
  label: string
  workflowId: string | null
  txHash: string | null
  status: string | null
  createdAt: string
}

const HELP = [
  'commands:',
  '  status          vault address + balances',
  '  ledger          deposits and agent payments',
  '  topup <amt>     deposit USDC into your vault (opens your wallet)',
  '  escrows         ERC-8183 job trail per run',
].join('\n')

export function BillingConsole() {
  const { user } = usePrivy()
  const wallet = user?.wallet?.address ?? null
  const usdc = useUSDCBalance(wallet)
  const topup = useTopup()
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const [busy, setBusy] = useState(false)
  const bootedRef = useRef(false)

  const say = useCallback(
    (
      text: string,
      opts: Partial<Pick<ConsoleLine, 'tag' | 'severity' | 'txHash'>> = {},
    ) => {
      setLines((prev) => [
        ...prev,
        {
          key: `b:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          ts: Date.now(),
          seq: 1,
          tag: opts.tag ?? 'SYS',
          severity: opts.severity ?? 'info',
          text,
          txHash: opts.txHash,
        },
      ])
    },
    [],
  )

  const status = useCallback(async () => {
    const r = await fetch('/api/me', { cache: 'no-store' })
    if (!r.ok) {
      say(`could not load account (${r.status})`, { tag: 'ERR', severity: 'error' })
      return
    }
    const me = await r.json()
    say(`vault address   ${me.dedicatedVaultAddress ?? '—'}`)
    say(
      `vault balance   ${typeof me.usdcBalance === 'number' ? `$${me.usdcBalance.toFixed(2)} USDC` : '…'}  (spendable — pays agents)`,
      { severity: 'success' },
    )
    say(
      `wallet balance  ${usdc.loading ? '…' : `$${usdc.formatted} USDC`}  (on-chain, deposit from here)`,
      { severity: 'muted' },
    )
  }, [say, usdc.loading, usdc.formatted])

  const ledger = useCallback(async () => {
    const r = await fetch('/api/me/ledger', { cache: 'no-store' })
    if (!r.ok) {
      say(`could not load ledger (${r.status})`, { tag: 'ERR', severity: 'error' })
      return
    }
    const { ledger: rows } = (await r.json()) as { ledger: LedgerEntry[] }
    if (!rows.length) {
      say('no movement yet — topup 5 to fund your vault', { severity: 'muted' })
      return
    }
    for (const row of rows) {
      const when = new Date(row.createdAt).toISOString().slice(0, 16).replace('T', ' ')
      const amt = `${row.amountUsdc > 0 ? '+' : '−'}$${Math.abs(row.amountUsdc).toFixed(3)}`
      say(`${when}  ${amt.padStart(9)}  ${row.kind.padEnd(6)} ${row.label}`, {
        tag: row.kind === 'topup' ? 'SYS' : 'x402',
        severity: row.amountUsdc > 0 ? 'success' : 'info',
        txHash: row.txHash ?? undefined,
      })
    }
  }, [say])

  // Narrate the top-up state machine.
  const lastStep = useRef(topup.step)
  useEffect(() => {
    if (topup.step === lastStep.current) return
    lastStep.current = topup.step
    if (topup.step === 'signing') say('awaiting wallet signature…')
    else if (topup.step === 'confirming') say('tx broadcast · confirming on Arc Testnet')
    else if (topup.step === 'granting') say('verifying deposit server-side…')
    else if (topup.step === 'done' && topup.result) {
      say(
        `deposited $${topup.result.grantedUsdc.toFixed(2)} · vault $${topup.result.balanceUsdc.toFixed(2)}`,
        { severity: 'success', txHash: topup.result.txHash },
      )
    } else if (topup.step === 'error') {
      say(`topup failed: ${topup.error ?? 'unknown error'}`, { tag: 'ERR', severity: 'error' })
    }
  }, [topup.step, topup.result, topup.error, say])

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    say('billing · vault and spend history · type help', { severity: 'muted' })
    status()
  }, [say, status])

  const handle = useCallback(
    async (input: string) => {
      say(input, { tag: 'YOU' })
      setBusy(true)
      try {
        const [cmd, ...rest] = input.trim().split(/\s+/)
        switch (cmd) {
          case 'help':
            say(HELP)
            break
          case 'status':
            await status()
            break
          case 'ledger':
            await ledger()
            break
          case 'clear':
            setLines([])
            break
          case 'escrows': {
            const r = await fetch('/api/me/escrows', { cache: 'no-store' })
            const j = await r.json().catch(() => ({ escrows: [] }))
            const list = (j.escrows ?? []) as {
              jobId: string
              stage: string
              budgetUsdc: string | null
              prompt: string
            }[]
            if (!list.length) {
              say('no escrow jobs yet', { severity: 'muted' })
              break
            }
            for (const e of list) {
              say(
                `job ${e.jobId.padEnd(8)} ${e.stage.padEnd(10)} $${e.budgetUsdc ?? '0.00'}  ${e.prompt.slice(0, 44)}`,
                { tag: 'ERC-8183', severity: e.stage === 'completed' ? 'success' : 'info' },
              )
            }
            break
          }
          case 'topup': {
            const amount = Number(rest[0])
            if (!Number.isFinite(amount) || amount <= 0) {
              say('usage: topup <amount in USDC>, e.g. topup 5', {
                tag: 'ERR',
                severity: 'error',
              })
              break
            }
            say(`depositing $${amount.toFixed(2)} USDC into your vault…`)
            await topup.topup(amount)
            break
          }
          default:
            say(`unknown: ${cmd} — try help`, { tag: 'ERR', severity: 'error' })
        }
      } catch (e) {
        say(e instanceof Error ? e.message : String(e), { tag: 'ERR', severity: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [ledger, say, status, topup],
  )

  return (
    <main className="gwt-page flex flex-col">
      <LogStream lines={lines} />
      <PromptInput onSubmit={handle} busy={busy} placeholder="status · ledger · topup 5 · help" />
    </main>
  )
}
