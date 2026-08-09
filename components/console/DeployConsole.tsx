'use client'

/**
 * DeployConsole — schedules and their notification targets.
 *
 * Replaces both the old DeployModal and the Settings page. The modal used
 * to dead-end at a "Go to Settings" link when a channel wasn't configured;
 * here you pick a saved target or add a new one without leaving the row.
 *
 * Two things worth knowing about the data model, which the UI states out
 * loud so the behaviour isn't surprising:
 *   - the DESTINATION (email address / chat id) is per-schedule
 *     (`deployments.notifyEmail` / `notifyTelegramId`)
 *   - the CREDENTIAL (Resend key / bot token) is account-wide on `users`
 */
import { useCallback, useEffect, useState } from 'react'

import { LogStream } from '@/components/console/LogStream'
import { PromptInput } from '@/components/console/PromptInput'
import type { ConsoleLine } from '@/lib/workflow/consoleLog'

type Channel = 'none' | 'email' | 'telegram' | 'both'

interface Deployment {
  id: string
  workflowId: string
  cronExpression: string
  status: string
  notifyChannels: Channel | null
  notifyEmail: string | null
  notifyTelegramId: string | null
  workflowPrompt: string | null
}

interface Profile {
  notifyEmail: string | null
  emailFrom: string | null
  hasEmailApiKey: boolean
  telegramChatId: string | null
  hasTelegramBotToken: boolean
}

interface Run {
  id: string
  prompt: string
  status: string
}

const CRON_PRESETS: Record<string, string> = {
  '10m': '*/10 * * * *',
  '30m': '*/30 * * * *',
  hourly: '0 * * * *',
  '6h': '0 */6 * * *',
  daily: '0 0 * * *',
}

const HELP = [
  'commands:',
  '  ls                             list schedules',
  '  new <runId> <schedule> [chan]  create/update — schedule: 10m|30m|hourly|6h|daily or a cron',
  '                                 chan: none|email|telegram|both',
  '  runs                           list recent runs (for their ids)',
  '  channels                       show saved notification channels',
  '  add telegram <bot-token>       save a Telegram bot (chat id auto-detects)',
  '  add email <address> <api-key>  save a Resend recipient + key',
  '  test email|telegram            send a real test message',
  '  pause <id> / rm <id> / run <id>',
].join('\n')

export function DeployConsole() {
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const [busy, setBusy] = useState(false)

  const say = useCallback(
    (text: string, opts: Partial<Pick<ConsoleLine, 'tag' | 'severity'>> = {}) => {
      setLines((prev) => [
        ...prev,
        {
          key: `d:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          ts: Date.now(),
          seq: 1,
          tag: opts.tag ?? 'SYS',
          severity: opts.severity ?? 'info',
          text,
        },
      ])
    },
    [],
  )

  const listSchedules = useCallback(async () => {
    const r = await fetch('/api/me/deployments', { cache: 'no-store' })
    if (!r.ok) {
      say(`could not load schedules (${r.status})`, { tag: 'ERR', severity: 'error' })
      return
    }
    const list = (await r.json()) as Deployment[]
    if (!Array.isArray(list) || !list.length) {
      say('no schedules yet — `new <runId> daily telegram` to create one', { severity: 'muted' })
      return
    }
    say('ID        CRON             STATE     NOTIFY                    WORKFLOW', {
      severity: 'muted',
    })
    for (const d of list) {
      const target =
        d.notifyChannels === 'none' || !d.notifyChannels
          ? 'none'
          : `${d.notifyChannels} → ${d.notifyTelegramId ?? d.notifyEmail ?? 'profile default'}`
      say(
        [
          d.id.slice(0, 8),
          d.cronExpression.padEnd(16),
          (d.status ?? '').padEnd(9),
          target.padEnd(25),
          (d.workflowPrompt ?? '').slice(0, 40),
        ].join(' '),
        { severity: d.status === 'active' ? 'success' : 'muted' },
      )
    }
  }, [say])

  const showChannels = useCallback(async () => {
    const r = await fetch('/api/me/profile', { cache: 'no-store' })
    if (!r.ok) {
      say(`could not load channels (${r.status})`, { tag: 'ERR', severity: 'error' })
      return null
    }
    const { profile } = (await r.json()) as { profile: Profile }
    const emailReady = !!profile.notifyEmail && profile.hasEmailApiKey
    say(
      `email     ${profile.notifyEmail ?? '—'}  ${emailReady ? '[ready]' : '[needs recipient + api key]'}`,
      { severity: emailReady ? 'success' : 'warn' },
    )
    say(
      `telegram  ${profile.telegramChatId ?? 'chat id auto-detects'}  ${profile.hasTelegramBotToken ? '[ready]' : '[needs bot token]'}`,
      { severity: profile.hasTelegramBotToken ? 'success' : 'warn' },
    )
    say('destination is per-schedule · api key / bot token is account-wide', {
      severity: 'muted',
    })
    return profile
  }, [say])

  useEffect(() => {
    say('deploy · schedules and notification channels · type help', { severity: 'muted' })
    listSchedules()
  }, [say, listSchedules])

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

          case 'ls':
            await listSchedules()
            break

          case 'channels':
            await showChannels()
            break

          case 'runs': {
            const r = await fetch('/api/workflows', { cache: 'no-store' })
            const j = await r.json()
            const runs = (j.workflows ?? []) as Run[]
            if (!runs.length) {
              say('no runs yet', { severity: 'muted' })
              break
            }
            for (const w of runs.slice(0, 15)) {
              say(`${w.id.slice(0, 8)}  ${(w.status ?? '').padEnd(10)} ${w.prompt.slice(0, 60)}`, {
                severity: 'muted',
              })
            }
            break
          }

          case 'add': {
            const kind = rest[0]
            if (kind === 'telegram') {
              const token = rest[1]
              if (!token) {
                say('usage: add telegram <bot-token>', { tag: 'ERR', severity: 'error' })
                break
              }
              const r = await fetch('/api/me/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegramBotToken: token }),
              })
              if (!r.ok) {
                say(`save failed (${r.status})`, { tag: 'ERR', severity: 'error' })
                break
              }
              say('telegram bot saved · chat id auto-detects on first send', {
                severity: 'success',
              })
            } else if (kind === 'email') {
              const [address, apiKey] = [rest[1], rest[2]]
              if (!address || !apiKey) {
                say('usage: add email <address> <resend-api-key>', {
                  tag: 'ERR',
                  severity: 'error',
                })
                break
              }
              const r = await fetch('/api/me/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notifyEmail: address, emailApiKey: apiKey }),
              })
              if (!r.ok) {
                say(`save failed (${r.status})`, { tag: 'ERR', severity: 'error' })
                break
              }
              say(`email channel saved → ${address}`, { severity: 'success' })
            } else {
              say('usage: add telegram <token> | add email <address> <api-key>', {
                tag: 'ERR',
                severity: 'error',
              })
            }
            break
          }

          case 'test': {
            const kind = rest[0]
            if (kind !== 'email' && kind !== 'telegram') {
              say('usage: test email|telegram', { tag: 'ERR', severity: 'error' })
              break
            }
            say(`sending a real test ${kind}…`)
            const r = await fetch('/api/me/profile/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind }),
            })
            const j = await r.json().catch(() => ({}))
            say(
              j.ok ? `test ${kind} sent` : `test failed: ${j.error ?? `HTTP ${r.status}`}`,
              { severity: j.ok ? 'success' : 'error', tag: j.ok ? 'SYS' : 'ERR' },
            )
            break
          }

          case 'new': {
            const [runId, sched, chan] = [rest[0], rest[1], rest[2] as Channel | undefined]
            if (!runId || !sched) {
              say('usage: new <runId> <schedule> [none|email|telegram|both]', {
                tag: 'ERR',
                severity: 'error',
              })
              break
            }
            const cron = CRON_PRESETS[sched] ?? sched
            const channels: Channel = chan ?? 'none'

            // Resolve the destination from the saved profile so it's stored
            // per-deployment. Sending them explicitly also means a later
            // edit never silently drops the target.
            let notifyEmail: string | null = null
            let notifyTelegramId: string | null = null
            if (channels !== 'none') {
              const pr = await fetch('/api/me/profile', { cache: 'no-store' })
              if (pr.ok) {
                const { profile } = (await pr.json()) as { profile: Profile }
                if (channels === 'email' || channels === 'both') notifyEmail = profile.notifyEmail
                if (channels === 'telegram' || channels === 'both')
                  notifyTelegramId = profile.telegramChatId
              }
            }

            const r = await fetch(`/api/workflow/${runId}/deploy`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cronExpression: cron,
                notifyChannels: channels,
                notifyEmail,
                notifyTelegramId,
              }),
            })
            const j = await r.json().catch(() => ({}))
            if (!r.ok) {
              say(`deploy failed: ${j.error ?? r.status}`, { tag: 'ERR', severity: 'error' })
              break
            }
            say(`scheduled ${cron} · notify ${channels}`, { severity: 'success' })
            await listSchedules()
            break
          }

          case 'pause': {
            const target = rest[0]
            if (!target) {
              say('usage: pause <id>', { tag: 'ERR', severity: 'error' })
              break
            }
            const r = await fetch(`/api/deployments/${target}`, { method: 'POST' })
            const j = await r.json().catch(() => ({}))
            say(r.ok ? `status → ${j.deployment?.status ?? 'toggled'}` : `failed (${r.status})`, {
              severity: r.ok ? 'success' : 'error',
              tag: r.ok ? 'SYS' : 'ERR',
            })
            await listSchedules()
            break
          }

          case 'rm': {
            const target = rest[0]
            if (!target) {
              say('usage: rm <id>', { tag: 'ERR', severity: 'error' })
              break
            }
            const r = await fetch(`/api/deployments/${target}`, { method: 'DELETE' })
            say(r.ok ? 'schedule deleted' : `delete failed (${r.status})`, {
              severity: r.ok ? 'success' : 'error',
              tag: r.ok ? 'SYS' : 'ERR',
            })
            await listSchedules()
            break
          }

          case 'run': {
            const target = rest[0]
            if (!target) {
              say('usage: run <id>', { tag: 'ERR', severity: 'error' })
              break
            }
            say('running the schedule now…')
            const r = await fetch(`/api/deployments/${target}/test`, { method: 'POST' })
            const j = await r.json().catch(() => ({}))
            say(r.ok ? `run finished: ${j.verdict ?? 'ok'}` : `run failed (${r.status})`, {
              severity: r.ok ? 'success' : 'error',
              tag: r.ok ? 'SYS' : 'ERR',
            })
            break
          }

          case 'clear':
            setLines([])
            break

          default:
            say(`unknown: ${cmd} — try help`, { tag: 'ERR', severity: 'error' })
        }
      } catch (e) {
        say(e instanceof Error ? e.message : String(e), { tag: 'ERR', severity: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [listSchedules, say, showChannels],
  )

  return (
    <main className="gwt-page flex flex-col">
      <LogStream lines={lines} />
      <PromptInput onSubmit={handle} busy={busy} placeholder="ls · new · add · test · help" />
    </main>
  )
}
