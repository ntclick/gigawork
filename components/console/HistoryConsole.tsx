'use client'

/**
 * HistoryConsole — past runs. Opening one lands on the console for that
 * workflow, which replays its whole timeline from the view-state API, so
 * there is no separate "past run" rendering path to keep in sync.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { LogStream } from '@/components/console/LogStream'
import { PromptInput } from '@/components/console/PromptInput'
import { extractReportMarkdown } from '@/lib/workflow/reportText'
import type { ConsoleLine } from '@/lib/workflow/consoleLog'

interface Run {
  id: string
  prompt: string
  status: string
  createdAt: string
}

const HELP = [
  'commands:',
  '  ls              list runs',
  '  open <id>       open a run in the console',
  '  report <id>     print that run’s deliverable here',
  '  rm <id>         delete a run',
].join('\n')

const STATUS_SEVERITY: Record<string, ConsoleLine['severity']> = {
  completed: 'success',
  failed: 'error',
  running: 'info',
  planning: 'info',
  queued: 'muted',
  funding: 'warn',
}

export function HistoryConsole() {
  const router = useRouter()
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const [busy, setBusy] = useState(false)
  const bootedRef = useRef(false)

  const push = useCallback((line: Omit<ConsoleLine, 'seq' | 'ts'>) => {
    setLines((prev) => [...prev, { ...line, ts: Date.now(), seq: 1 }])
  }, [])

  const say = useCallback(
    (text: string, opts: Partial<Pick<ConsoleLine, 'tag' | 'severity'>> = {}) => {
      push({
        key: `h:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        tag: opts.tag ?? 'SYS',
        severity: opts.severity ?? 'info',
        text,
      })
    },
    [push],
  )

  const list = useCallback(async () => {
    const r = await fetch('/api/workflows', { cache: 'no-store' })
    if (!r.ok) {
      say(`could not load runs (${r.status})`, { tag: 'ERR', severity: 'error' })
      return
    }
    const j = await r.json()
    const runs = (j.workflows ?? []) as Run[]
    if (!runs.length) {
      say('no runs yet — go to the console and describe an objective', { severity: 'muted' })
      return
    }
    say('WHEN              STATUS      ID        PROMPT', { severity: 'muted' })
    for (const w of runs) {
      const when = new Date(w.createdAt).toISOString().slice(0, 16).replace('T', ' ')
      say(
        `${when}  ${(w.status ?? '').padEnd(11)} ${w.id.slice(0, 8)}  ${w.prompt.slice(0, 52)}`,
        { severity: STATUS_SEVERITY[w.status] ?? 'info' },
      )
    }
    say('open <id> · report <id> · rm <id>', { severity: 'muted' })
  }, [say])

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    list()
  }, [list])

  const resolveId = useCallback(async (prefix: string): Promise<string | null> => {
    const r = await fetch('/api/workflows', { cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json()
    const runs = (j.workflows ?? []) as Run[]
    return runs.find((w) => w.id.startsWith(prefix))?.id ?? null
  }, [])

  const handle = useCallback(
    async (input: string) => {
      say(input, { tag: 'YOU' })
      setBusy(true)
      try {
        const [cmd, arg] = input.trim().split(/\s+/)
        switch (cmd) {
          case 'help':
            say(HELP)
            break
          case 'ls':
            await list()
            break
          case 'clear':
            setLines([])
            break
          case 'open': {
            if (!arg) {
              say('usage: open <id>', { tag: 'ERR', severity: 'error' })
              break
            }
            const id = await resolveId(arg)
            if (!id) {
              say(`no run matching ${arg}`, { tag: 'ERR', severity: 'error' })
              break
            }
            router.push(`/workflow/${id}`)
            break
          }
          case 'report': {
            if (!arg) {
              say('usage: report <id>', { tag: 'ERR', severity: 'error' })
              break
            }
            const id = await resolveId(arg)
            if (!id) {
              say(`no run matching ${arg}`, { tag: 'ERR', severity: 'error' })
              break
            }
            const r = await fetch(`/api/workflow/${id}/messages`, { cache: 'no-store' })
            const j = await r.json().catch(() => ({}))
            const md = extractReportMarkdown(j.messages)
            if (!md) {
              say('that run has no deliverable yet', { severity: 'warn' })
              break
            }
            push({
              key: `report:${id}:${Date.now()}`,
              tag: 'SYS',
              severity: 'success',
              text: `deliverable · ${id.slice(0, 8)}`,
              block: { kind: 'report', markdown: md },
            })
            break
          }
          case 'rm': {
            if (!arg) {
              say('usage: rm <id>', { tag: 'ERR', severity: 'error' })
              break
            }
            const id = await resolveId(arg)
            if (!id) {
              say(`no run matching ${arg}`, { tag: 'ERR', severity: 'error' })
              break
            }
            const r = await fetch(`/api/workflow/${id}`, { method: 'DELETE' })
            say(r.ok ? `deleted ${id.slice(0, 8)}` : `delete failed (${r.status})`, {
              severity: r.ok ? 'success' : 'error',
              tag: r.ok ? 'SYS' : 'ERR',
            })
            await list()
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
    [list, push, resolveId, router, say],
  )

  return (
    <main className="gwt-page flex flex-col">
      <LogStream lines={lines} />
      <PromptInput onSubmit={handle} busy={busy} placeholder="ls · open <id> · report <id> · help" />
    </main>
  )
}
