'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { type ConsoleLine, formatConsoleTime } from '@/lib/workflow/consoleLog'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

const SEVERITY_CLASS: Record<ConsoleLine['severity'], string> = {
  info: 'gwt-info',
  success: 'gwt-success',
  warn: 'gwt-warn',
  error: 'gwt-error',
  muted: 'gwt-muted',
}

const TAG_CLASS: Record<string, string> = {
  YOU: 'text-white/70',
  SYS: 'text-white/40',
  PLAN: 'text-[var(--gw-violet)]',
  AGENT: 'text-[var(--gw-cyan)]',
  x402: 'text-[var(--gw-emerald)]',
  'ERC-8183': 'text-[var(--gw-amber)]',
  'ERC-8004': 'text-[var(--gw-cyan)]',
  DATA: 'text-white/30',
  ERR: 'text-[var(--gw-rose)]',
}

function ReportBlock({ markdown }: { markdown: string }) {
  const save = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gigawork-report-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="gwt-report">
      <div className="gwt-report-bar">
        <span>deliverable</span>
        <span className="flex gap-2">
          <button className="gwt-token" onClick={() => navigator.clipboard.writeText(markdown)}>
            copy
          </button>
          <button className="gwt-token" onClick={save}>
            save
          </button>
        </span>
      </div>
      <div className="gwt-report-body">
        <div className="gwt-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

export function LogLine({
  line,
  onAction,
}: {
  line: ConsoleLine
  onAction?: (id: string) => void
}) {
  if (line.block?.kind === 'report') {
    return (
      <li>
        <div className="gwt-row">
          <span className="gwt-time">{formatConsoleTime(line.ts)}</span>
          <span className={`gwt-tag ${TAG_CLASS[line.tag] ?? ''}`}>{line.tag}</span>
          <span className={SEVERITY_CLASS[line.severity]}>{line.text}</span>
        </div>
        <ReportBlock markdown={line.block.markdown} />
      </li>
    )
  }

  return (
    <li>
      <div className="gwt-row">
        <span className="gwt-time">{formatConsoleTime(line.ts)}</span>
        <span className={`gwt-tag ${TAG_CLASS[line.tag] ?? ''}`}>{line.tag}</span>
        <span className={SEVERITY_CLASS[line.severity]}>
          {line.text}
          {line.pending && <span className="gw-cursor-blink ml-1">▌</span>}
          {line.action && onAction && (
            <button className="gwt-token ml-2" onClick={() => onAction(line.action!.id)}>
              {line.action.label}
            </button>
          )}
          {line.txHash && (
            <a
              href={`${EXPLORER}/tx/${line.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="ml-2 text-[var(--gw-cyan)] underline-offset-2 hover:underline"
            >
              ↗ {line.txHash.slice(0, 10)}…
            </a>
          )}
        </span>
      </div>
      {line.detail && <div className="gwt-row"><span /><span /><span className="gwt-detail">{line.detail}</span></div>}
    </li>
  )
}
