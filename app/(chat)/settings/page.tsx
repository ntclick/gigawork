'use client'

/**
 * /settings — per-user notification settings.
 *
 * Each user runs their own email account (Resend) + their own Telegram
 * bot (BotFather). The platform never hosts a shared bot or pays for
 * email — every credential here is supplied by the user and stored
 * once. Tokens are never echoed back in clear text.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  MessageSquare,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react'

import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'
import { toast } from '@/components/ui/toast'

type Profile = {
  notifyEmail: string | null
  emailFrom: string | null
  hasEmailApiKey: boolean
  emailApiKeyMasked: string | null
  telegramChatId: string | null
  hasTelegramBotToken: boolean
  telegramBotTokenMasked: string | null
}

type TestResult = {
  ok: boolean
  provider?: string
  message_id?: string | number | null
  error?: string
  note?: string
}

type Me = {
  wallet: string
  profile: Profile
}

export default function SettingsPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = () =>
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: Me) => setMe(j))

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  return (
    <div className="giga-theme flex h-full w-full flex-col">
      <MainHeader />
      <div className="flex flex-1 overflow-hidden">
        <HistorySidebar />
        <AppRail />
        <main className="flex-1 overflow-y-auto bg-[#0f131c] p-4 sm:p-8">
          <div className="mx-auto w-full max-w-2xl">
            <div className="mb-6 flex items-center gap-3">
              <Link
                href="/"
                className="inline-flex h-8 w-8 items-center justify-center border-2 border-black bg-[var(--giga-panel)] text-white/70 hover:text-white"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <h1 className="font-pixel-header text-xl text-white sm:text-2xl">Settings</h1>
            </div>

            {loading || !me ? (
              <div className="flex items-center justify-center border-2 border-black bg-[var(--giga-panel)] py-16 text-white/55">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading profile…
              </div>
            ) : (
              <div className="space-y-4">
                {/* Wallet */}
                <div className="border-2 border-black bg-[var(--giga-panel)] p-4">
                  <div className="text-xs uppercase tracking-wider text-white/55">Wallet</div>
                  <div className="mt-1 break-all font-mono text-sm text-white">{me.wallet}</div>
                </div>

                <ProfileForm profile={me.profile} onSaved={refresh} />

                {/* Info card */}
                <div className="border-2 border-cyan-400/30 bg-cyan-400/[0.05] p-4 text-sm text-white/70">
                  <div className="mb-2 font-medium text-cyan-200">How notifications work</div>
                  <ul className="space-y-1.5 text-xs leading-relaxed">
                    <li>
                      ▸ Each user runs their own email + Telegram bot. The platform never
                      hosts a shared sender or pays for delivery.
                    </li>
                    <li>
                      ▸ When a workflow uses{' '}
                      <span className="font-mono text-cyan-300">email-sender</span> or{' '}
                      <span className="font-mono text-cyan-300">telegram-sender</span>, results
                      go to your saved destinations using your saved credentials.
                    </li>
                    <li>
                      ▸ Per-workflow override is supported in the prompt
                      (e.g. "email me at <span className="font-mono">other@x.com</span>").
                    </li>
                    <li>
                      ▸ If credentials are unset, the matching skill runs in dev-mock mode —
                      it logs to the server console and returns a realistic response so the
                      workflow chain still completes.
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function ProfileForm({
  profile,
  onSaved,
}: {
  profile: Profile
  onSaved: () => Promise<void>
}) {
  // ─── Email state ───
  const [email, setEmail] = useState(profile.notifyEmail ?? '')
  const [emailFrom, setEmailFrom] = useState(profile.emailFrom ?? '')
  const [emailKey, setEmailKey] = useState('')
  const [showEmailKey, setShowEmailKey] = useState(false)
  const [clearEmailKey, setClearEmailKey] = useState(false)
  // ─── Telegram state ───
  const [chatId, setChatId] = useState(profile.telegramChatId ?? '')
  const [botToken, setBotToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [clearToken, setClearToken] = useState(false)
  // ─── UI state ───
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [testingEmail, setTestingEmail] = useState(false)
  const [testingTg, setTestingTg] = useState(false)
  const [emailTestResult, setEmailTestResult] = useState<TestResult | null>(null)
  const [tgTestResult, setTgTestResult] = useState<TestResult | null>(null)

  const initialEmail = profile.notifyEmail ?? ''
  const initialFrom = profile.emailFrom ?? ''
  const initialChatId = profile.telegramChatId ?? ''
  const dirty =
    email !== initialEmail ||
    emailFrom !== initialFrom ||
    chatId !== initialChatId ||
    emailKey.length > 0 ||
    botToken.length > 0 ||
    clearEmailKey ||
    clearToken

  const sendTest = async (kind: 'email' | 'telegram') => {
    if (kind === 'email') {
      setTestingEmail(true)
      setEmailTestResult(null)
    } else {
      setTestingTg(true)
      setTgTestResult(null)
    }
    try {
      const r = await fetch('/api/me/profile/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      })
      const j = (await r.json()) as TestResult
      const result = { ...j, ok: j.ok ?? false }
      if (kind === 'email') setEmailTestResult(result)
      else setTgTestResult(result)
      if (result.ok) {
        toast.success(
          kind === 'email' ? 'Test email sent' : 'Test Telegram sent',
          result.provider === 'dev-mock' ? 'dev-mock (creds not set)' : `via ${result.provider}`,
        )
      } else {
        toast.error('Test failed', result.error ?? 'unknown error')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const r = { ok: false, error: msg }
      if (kind === 'email') setEmailTestResult(r)
      else setTgTestResult(r)
      toast.error('Test failed', msg)
    } finally {
      if (kind === 'email') setTestingEmail(false)
      else setTestingTg(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      // Only send dirty fields so unset values don't get accidentally cleared.
      const body: Record<string, string | null> = {}
      if (email !== initialEmail) body.notifyEmail = email
      if (emailFrom !== initialFrom) body.emailFrom = emailFrom
      if (chatId !== initialChatId) body.telegramChatId = chatId
      if (clearEmailKey) body.emailApiKey = ''
      else if (emailKey.length > 0) body.emailApiKey = emailKey
      if (clearToken) body.telegramBotToken = ''
      else if (botToken.length > 0) body.telegramBotToken = botToken

      const r = await fetch('/api/me/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await r.json()) as { ok?: boolean; error?: string }
      if (!r.ok || !j.ok) {
        toast.error('Save failed', j.error ?? `HTTP ${r.status}`)
        return
      }
      await onSaved()
      setEmailKey('')
      setBotToken('')
      setClearEmailKey(false)
      setClearToken(false)
      setShowEmailKey(false)
      setShowToken(false)
      setSavedAt(Date.now())
      toast.success('Profile saved')
    } catch (e) {
      toast.error('Save failed', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-2 border-black bg-[var(--giga-panel)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--giga-accent)]">
          Notification settings
        </h2>
        {savedAt && Date.now() - savedAt < 3000 && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>

      {/* ═══════ EMAIL SECTION ═══════ */}
      <div className="mb-6 border border-white/10 bg-[var(--giga-dark)]/50 p-4">
        <h3 className="mb-3 inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-pink-300">
          <Mail className="h-3.5 w-3.5" /> Email · Resend
        </h3>

        {/* Recipient */}
        <div className="mb-4">
          <label className="mb-1.5 block text-xs uppercase tracking-wider text-white/65">
            Recipient address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border-2 border-black bg-[#1f1f33] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[var(--giga-accent)] focus:outline-none"
          />
          <p className="mt-1 text-xs text-white/45">
            Where the email-sender agent ships results.
          </p>
        </div>

        {/* API key */}
        <div className="mb-4">
          <label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/65">
            <ShieldCheck className="h-3.5 w-3.5 text-pink-300" />
            Resend API key
          </label>

          {profile.hasEmailApiKey && emailKey.length === 0 && !clearEmailKey && (
            <div className="mb-2 flex items-center justify-between border-2 border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs">
              <span className="font-mono text-emerald-200">
                {profile.emailApiKeyMasked ?? '••••••'}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-emerald-300/85">saved</span>
                <button onClick={() => setClearEmailKey(true)} className="text-red-300 hover:text-red-200">
                  Remove
                </button>
              </div>
            </div>
          )}

          {clearEmailKey && (
            <div className="mb-2 flex items-center justify-between border-2 border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs">
              <span className="text-amber-200">Will be cleared on save.</span>
              <button onClick={() => setClearEmailKey(false)} className="text-amber-200 hover:text-amber-100">
                Undo
              </button>
            </div>
          )}

          <div className="flex items-stretch gap-2">
            <input
              type={showEmailKey ? 'text' : 'password'}
              value={emailKey}
              onChange={(e) => setEmailKey(e.target.value)}
              placeholder={
                profile.hasEmailApiKey
                  ? 'Paste a new key to replace the saved one'
                  : 're_xxxxxxxxxxxxxxxxxxxxxxxxx'
              }
              autoComplete="off"
              className="flex-1 border-2 border-black bg-[#1f1f33] px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:border-[var(--giga-accent)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowEmailKey((v) => !v)}
              className="border-2 border-black bg-[#1f1f33] px-3 text-white/65 hover:text-white"
              aria-label={showEmailKey ? 'Hide' : 'Show'}
            >
              {showEmailKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-xs text-white/45">
            Get a free key (3000 emails/month) at{' '}
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 underline-offset-2 hover:underline"
            >
              resend.com
            </a>
            . Stored once, never shown back.
          </p>
        </div>

        {/* From sender */}
        <div>
          <label className="mb-1.5 block text-xs uppercase tracking-wider text-white/65">
            Sender (From)
          </label>
          <input
            type="text"
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder='onboarding@resend.dev  or  "GigaWork Alerts <noreply@your.domain>"'
            className="w-full border-2 border-black bg-[#1f1f33] px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:border-[var(--giga-accent)] focus:outline-none"
          />
          <p className="mt-1 text-xs text-white/45">
            Use <span className="font-mono">onboarding@resend.dev</span> to test (only sends to
            your verified email). For real delivery, verify your own domain in Resend → Domains.
          </p>
        </div>

        {/* Send test */}
        <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-white/55">
              Send a test email to <span className="font-mono text-white/75">
                {profile.notifyEmail || 'your saved address'}
              </span>
            </div>
            <button
              type="button"
              disabled={testingEmail || !profile.notifyEmail || dirty}
              onClick={() => sendTest('email')}
              title={
                dirty
                  ? 'Save changes first'
                  : !profile.notifyEmail
                    ? 'Set recipient first'
                    : 'Send a test email'
              }
              className="inline-flex items-center gap-1.5 border-2 border-black bg-[#1f1f33] px-3 py-1.5 text-xs text-white/85 transition hover:bg-[#27273f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {testingEmail ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send test
            </button>
          </div>
          {emailTestResult && <TestResultLine result={emailTestResult} />}
        </div>
      </div>

      {/* ═══════ TELEGRAM SECTION ═══════ */}
      <div className="mb-3 border border-white/10 bg-[var(--giga-dark)]/50 p-4">
        <h3 className="mb-3 inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-pink-300">
          <MessageSquare className="h-3.5 w-3.5" /> Telegram · Bot
        </h3>

        {/* Bot token */}
        <div className="mb-4">
          <label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/65">
            <ShieldCheck className="h-3.5 w-3.5 text-pink-300" />
            Bot token
          </label>

          {profile.hasTelegramBotToken && botToken.length === 0 && !clearToken && (
            <div className="mb-2 flex items-center justify-between border-2 border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs">
              <span className="font-mono text-emerald-200">
                {profile.telegramBotTokenMasked ?? '••••••'}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-emerald-300/85">saved</span>
                <button onClick={() => setClearToken(true)} className="text-red-300 hover:text-red-200">
                  Remove
                </button>
              </div>
            </div>
          )}

          {clearToken && (
            <div className="mb-2 flex items-center justify-between border-2 border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs">
              <span className="text-amber-200">Will be cleared on save.</span>
              <button onClick={() => setClearToken(false)} className="text-amber-200 hover:text-amber-100">
                Undo
              </button>
            </div>
          )}

          <div className="flex items-stretch gap-2">
            <input
              type={showToken ? 'text' : 'password'}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={
                profile.hasTelegramBotToken
                  ? 'Paste a new token to replace the saved one'
                  : '1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
              }
              autoComplete="off"
              className="flex-1 border-2 border-black bg-[#1f1f33] px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:border-[var(--giga-accent)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="border-2 border-black bg-[#1f1f33] px-3 text-white/65 hover:text-white"
              aria-label={showToken ? 'Hide' : 'Show'}
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-xs text-white/45">
            Create a bot via{' '}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 underline-offset-2 hover:underline"
            >
              @BotFather
            </a>{' '}
            (<span className="font-mono">/newbot</span>) and paste the token here.
          </p>
        </div>

        {/* Chat id */}
        <div>
          <label className="mb-1.5 block text-xs uppercase tracking-wider text-white/65">
            Chat ID
          </label>
          <input
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="123456789  or  @your_channel"
            className="w-full border-2 border-black bg-[#1f1f33] px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:border-[var(--giga-accent)] focus:outline-none"
          />
          <p className="mt-1 text-xs text-white/45">
            DM{' '}
            <a
              href="https://t.me/userinfobot"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 underline-offset-2 hover:underline"
            >
              @userinfobot
            </a>{' '}
            to get your numeric id, then start a chat with YOUR bot so it can message you.
          </p>
        </div>

        {/* Send test */}
        <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-white/55">
              Send a test message to <span className="font-mono text-white/75">
                {profile.telegramChatId || 'your saved chat'}
              </span>
            </div>
            <button
              type="button"
              disabled={testingTg || !profile.telegramChatId || dirty}
              onClick={() => sendTest('telegram')}
              title={
                dirty
                  ? 'Save changes first'
                  : !profile.telegramChatId
                    ? 'Set chat id first'
                    : 'Send a test Telegram message'
              }
              className="inline-flex items-center gap-1.5 border-2 border-black bg-[#1f1f33] px-3 py-1.5 text-xs text-white/85 transition hover:bg-[#27273f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {testingTg ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send test
            </button>
          </div>
          {tgTestResult && <TestResultLine result={tgTestResult} />}
        </div>
      </div>

      <button
        onClick={save}
        disabled={!dirty || saving}
        className="inline-flex w-full items-center justify-center gap-1.5 border-2 border-black bg-[var(--giga-accent)] px-4 py-2 text-sm font-bold text-black transition hover:bg-yellow-300 disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {saving ? 'Saving…' : dirty ? 'Save profile' : 'Saved'}
      </button>
    </div>
  )
}

function TestResultLine({ result }: { result: TestResult }) {
  if (result.ok) {
    const isMock = result.provider === 'dev-mock'
    return (
      <div
        className={`flex items-start gap-2 border-2 px-3 py-2 text-xs ${
          isMock
            ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
            : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
        }`}
      >
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div>
            {isMock ? 'Logged to server (dev-mock)' : `Sent via ${result.provider}`}
            {result.message_id ? (
              <span className="ml-1 font-mono text-white/55">id={String(result.message_id)}</span>
            ) : null}
          </div>
          {result.note && <div className="mt-0.5 text-white/55">{result.note}</div>}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 border-2 border-red-400/50 bg-red-500/10 px-3 py-2 text-xs text-red-200">
      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{result.error ?? 'Test failed'}</div>
    </div>
  )
}
