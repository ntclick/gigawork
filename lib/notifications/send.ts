/**
 * lib/notifications/send.ts
 *
 * Central notification dispatcher for GigaWork.
 * Routes to Email (Resend) or Telegram based on the deployment's
 * notifyChannels setting, falling back to user profile credentials.
 *
 * Called by lib/deployments/runCheck.ts after each cron execution.
 * Fire-and-forget: errors are logged but never bubble up to the caller.
 */
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { decryptProfileSecrets } from '@/lib/notifications/secrets'
import { type SignalThesis } from '@/lib/types/thesis'

export type NotifyChannel = 'none' | 'email' | 'telegram' | 'both'

export interface NotifyOptions {
  userId: string
  channels: NotifyChannel | null
  /** Override the user's profile email — if omitted, use users.notifyEmail */
  overrideEmail?: string | null
  /** Override the user's profile telegram chat ID — if omitted, use users.telegramChatId */
  overrideChatId?: string | null
  subject: string
  /** Plain-text summary for Telegram */
  plainText: string
  /** Markdown body for email + Telegram (Telegram uses its own subset) */
  markdownBody: string
  /** Optional link to view the full report */
  reportUrl?: string
}

/**
 * Sends a notification through the configured channels.
 * Silently swallows all errors — never throws.
 */
export async function sendDeployNotification(opts: NotifyOptions): Promise<void> {
  const { channels } = opts
  if (!channels || channels === 'none') return

  // Fetch only necessary user credentials from DB. The two secrets are
  // stored encrypted (lib/notifications/secrets.ts) — decrypt before use.
  const [row] = await db
    .select({
      id: users.id,
      notifyEmail: users.notifyEmail,
      emailApiKey: users.emailApiKey,
      emailFrom: users.emailFrom,
      telegramBotToken: users.telegramBotToken,
      telegramChatId: users.telegramChatId,
    })
    .from(users)
    .where(eq(users.id, opts.userId))
    .limit(1)
    .catch(() => [null])
  const u = decryptProfileSecrets(row)
  if (!u) return

  const doEmail = channels === 'email' || channels === 'both'
  const doTelegram = channels === 'telegram' || channels === 'both'

  const promises: Promise<void>[] = []

  if (doEmail) {
    const toEmail = opts.overrideEmail || u.notifyEmail
    if (toEmail && u.emailApiKey) {
      promises.push(sendEmail({
        to: toEmail.trim(),
        from: (u.emailFrom ?? 'onboarding@resend.dev').trim(),
        apiKey: u.emailApiKey.trim(),
        subject: opts.subject,
        markdownBody: opts.markdownBody,
        reportUrl: opts.reportUrl,
      }).catch((e) => {
        console.error('[notify] Email send failed:', e instanceof Error ? e.message : 'Unknown error')
      }))
    }
  }

  if (doTelegram) {
    const rawChatId = opts.overrideChatId || u.telegramChatId
    const rawBotToken = u.telegramBotToken
    if (rawChatId && rawBotToken) {
      const chatId = rawChatId.trim()
      const botToken = rawBotToken.trim()

      // Security check: validate token format (e.g. 123456789:ABCdefGHI...)
      if (/^\d{8,}:[A-Za-z0-9_-]{30,}$/.test(botToken) && /^[-0-9a-zA-Z_@]+$/.test(chatId)) {
        promises.push(sendTelegram({
          chatId,
          botToken,
          message: formatTelegramMessage(opts),
        }).catch((e) => {
          console.error('[notify] Telegram send failed:', e instanceof Error ? e.message : 'Unknown error')
        }))
      } else {
        console.warn(`[notify] Invalid Telegram credentials format for user ${opts.userId}`)
      }
    }
  }

  await Promise.allSettled(promises)
}

// ─── Email via Resend ─────────────────────────────────────────────────────────

async function sendEmail(params: {
  to: string
  from: string
  apiKey: string
  subject: string
  markdownBody: string
  reportUrl?: string
}): Promise<void> {
  const html = buildEmailHtml(params.subject, params.markdownBody, params.reportUrl)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Resend API ${res.status}: ${body.slice(0, 200)}`)
  }
}

// ─── Telegram via Bot API ─────────────────────────────────────────────────────

async function sendTelegram(params: {
  chatId: string
  botToken: string
  message: string
}): Promise<void> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(params.botToken)}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: params.chatId,
      text: params.message,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Telegram API ${res.status}: ${body.slice(0, 200)}`)
  }
}

// ─── Message Formatters ───────────────────────────────────────────────────────

function formatTelegramMessage(opts: NotifyOptions): string {
  const lines: string[] = [
    `🤖 *GigaWork Alert*`,
    ``,
    `📋 *${escapeMarkdown(opts.subject.replace(/^\[GigaWork\]\s*/, ''))}*`,
    ``,
    escapeMarkdown(opts.plainText),
  ]
  if (opts.reportUrl) {
    lines.push(``, `🔗 [View Full Report](${opts.reportUrl})`)
  }
  return lines.join('\n')
}

/** Escape Telegram MarkdownV1 special chars (only in user-supplied strings) */
function escapeMarkdown(text: string): string {
  // Telegram MarkdownV1 only requires * _ ` [ ] ( ) to be escaped in links
  // For simple notifications we just strip the most dangerous chars
  return text
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
}

function buildEmailHtml(subject: string, markdownBody: string, reportUrl?: string): string {
  // Simple markdown → HTML (no external deps needed for notification emails)
  let body = markdownBody
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:#1a1a2e;color:#22d3ee;padding:2px 6px;border-radius:4px;font-size:12px">$1</code>')
    .replace(/^## (.+)$/gm, '<h2 style="color:#22d3ee;font-size:16px;margin:20px 0 8px">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="color:#a5f3fc;font-size:14px;margin:16px 0 6px">$1</h3>')
    .replace(/^- (.+)$/gm, '<li style="color:#c7d2fe;margin:4px 0">$1</li>')
    .replace(/\n\n/g, '</p><p style="color:#e2e8f0;font-size:14px;line-height:1.7;margin:8px 0">')

  const reportBtn = reportUrl
    ? `<div style="text-align:center;margin:28px 0">
        <a href="${reportUrl}" style="background:linear-gradient(135deg,#06b6d4,#3b82f6);color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;display:inline-block">
          📊 View Full Report →
        </a>
      </div>`
    : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="background:#0b0e17;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#12101f,#1a1033);border:1px solid rgba(99,102,241,0.3);border-radius:12px;padding:20px 24px;margin-bottom:24px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:20px">🤖</span>
        <span style="color:#a5b4fc;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px">GigaWork Alert</span>
      </div>
      <h1 style="color:white;font-size:18px;margin:0;font-weight:600">${subject.replace(/^\[GigaWork\]\s*/, '')}</h1>
    </div>

    <!-- Body -->
    <div style="background:#12101f;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;margin-bottom:20px">
      <p style="color:#e2e8f0;font-size:14px;line-height:1.7;margin:0">${body}</p>
    </div>

    ${reportBtn}

    <!-- Footer -->
    <div style="text-align:center;color:rgba(255,255,255,0.25);font-size:11px;margin-top:24px">
      Sent by GigaWork Hermes Scheduler · <a href="https://gigawork.ai/settings" style="color:rgba(99,102,241,0.7);text-decoration:none">Manage notifications</a>
    </div>
  </div>
</body>
</html>`
}

// ─── Format Helpers ───────────────────────────────────────────────────────────

export function formatCheckResultNotification(params: {
  prompt: string
  thesis: SignalThesis
  note: string
  nodeResults: Array<{ label: string; status: string; output: unknown }>
  workflowUrl?: string
  checkedAt?: Date
}): Pick<NotifyOptions, 'subject' | 'plainText' | 'markdownBody'> {
  const { prompt, thesis, note, nodeResults, checkedAt } = params
  const ts = (checkedAt ?? new Date()).toLocaleString('en-US', { timeZone: 'UTC', hour12: false })

  const subject = `[GigaWork] ${prompt.slice(0, 55)}${prompt.length > 55 ? '…' : ''} — ${thesis.verdict} (${thesis.confidence}%)`

  const completedNodes = nodeResults.filter((n) => n.status === 'complete' || n.status === 'completed')
  const failedNodes = nodeResults.filter((n) => n.status === 'failed')

  const nodeLines = completedNodes.map((n) => {
    const out = (n.output && typeof n.output === 'object') ? n.output as Record<string, unknown> : {}
    const summary = (out.summary ?? out.outputSummary ?? out.markdown ?? '') as string
    return `- **${n.label}**: ${summary ? summary.slice(0, 120) : 'Completed'}`
  }).join('\n')

  const markdownBody = `## 📊 Workflow Result

**Task:** ${prompt}

**Verdict:** ${thesis.verdict} · **Confidence:** ${thesis.confidence}%

**Analysis:** ${note}

${thesis.supporting.length > 0 ? `### Supporting Evidence\n${thesis.supporting.map((s) => `- ${s}`).join('\n')}` : ''}

${thesis.counterpoint ? `**Counterpoint:** ${thesis.counterpoint}` : ''}
${thesis.invalidation ? `**Invalidation Trigger:** ${thesis.invalidation}` : ''}

${completedNodes.length > 0 ? `### Agent Results\n${nodeLines}` : ''}

${failedNodes.length > 0 ? `### ⚠️ Failed Agents\n${failedNodes.map((n) => `- ${n.label}`).join('\n')}` : ''}

---
*Checked at ${ts} UTC · Source: ${thesis.dataSource ?? 'GigaWork Signal Pipeline'}*`

  const plainText = `Verdict: ${thesis.verdict} (${thesis.confidence}% confidence)\n${note}`

  return { subject, plainText, markdownBody }
}
