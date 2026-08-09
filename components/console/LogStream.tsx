'use client'

import { type ConsoleLine } from '@/lib/workflow/consoleLog'
import { useStickToBottom } from '@/lib/hooks/useStickToBottom'
import { LogLine } from './LogLine'

/** Keeps the DOM bounded on long runs without pulling in a virtualiser. */
const WINDOW = 500

export function LogStream({
  lines,
  header,
  onAction,
}: {
  lines: ConsoleLine[]
  /** Rendered above the log — the home masthead lives here. */
  header?: React.ReactNode
  onAction?: (id: string) => void
}) {
  const { ref, stuck, missed, onScroll, scrollToBottom } = useStickToBottom(lines.length)

  const hidden = Math.max(0, lines.length - WINDOW)
  const visible = hidden > 0 ? lines.slice(-WINDOW) : lines

  return (
    <div ref={ref} onScroll={onScroll} className="gwt-scroll relative">
      {header}
      {hidden > 0 && (
        <div className="gwt-row">
          <span className="gwt-time">──</span>
          <span className="gwt-tag" />
          <span className="gwt-muted">{hidden.toLocaleString()} earlier lines hidden</span>
        </div>
      )}

      <ol>
        {visible.map((l) => (
          <LogLine key={l.key} line={l} onAction={onAction} />
        ))}
      </ol>

      {!stuck && missed > 0 && (
        <button
          onClick={scrollToBottom}
          className="sticky bottom-1 left-0 w-full bg-[var(--gw-cyan)] py-0.5 text-[11px] font-semibold text-[#05060a]"
        >
          ── {missed} new line{missed === 1 ? '' : 's'} · press End to follow ──
        </button>
      )}
    </div>
  )
}
