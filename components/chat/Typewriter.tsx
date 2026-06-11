'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * MarkdownTypewriter — reveals a markdown string char-by-char so the brain's
 * final report feels like it's being typed live (a la ChatGPT). Blinking
 * cursor at the end while typing; once complete, plays a one-shot fade-in on
 * the now-fully-rendered markdown so the layout settles smoothly.
 *
 * Why we do char-level (not word-level): markdown formatting tags (`**`,
 * `__`, fenced code blocks) need contiguous chars to parse correctly. ReactMarkdown
 * tolerates partial markdown — unclosed tags just render as plaintext until the
 * closing token arrives. We hide the visual jitter by typing fast (16 chars/tick).
 *
 * Caches the typing progress per `text` content so re-renders don't restart
 * (e.g. parent state change).
 */
interface TypewriterProps {
  text: string
  /** Chars revealed per tick. Higher = faster. Default 14. */
  charsPerTick?: number
  /** Tick interval in ms. Default 22. */
  tickMs?: number
  /** When true, renders text immediately (used after first reveal) */
  instant?: boolean
  /** Class names for the article wrapper */
  className?: string
  /** Callback when typing finishes */
  onDone?: () => void
}

export function MarkdownTypewriter({
  text,
  charsPerTick = 14,
  tickMs = 22,
  instant = false,
  className = 'gw-md text-sm text-white/85',
  onDone,
}: TypewriterProps) {
  const [shown, setShown] = useState(instant ? text : '')
  const lastTextRef = useRef<string>('')
  const doneRef = useRef(false)

  useEffect(() => {
    // If text changed completely, restart. If text just grew (streaming), continue.
    if (text === lastTextRef.current) return
    const grew = text.startsWith(lastTextRef.current) && lastTextRef.current.length > 0
    lastTextRef.current = text
    doneRef.current = false

    let tInit: NodeJS.Timeout | undefined

    if (instant || !text) {
      tInit = setTimeout(() => setShown(text), 0)
      return () => {
        if (tInit) clearTimeout(tInit)
      }
    }

    // If grew, keep current shown and just race to catch up
    let idx = grew ? shown.length : 0
    if (!grew) {
      tInit = setTimeout(() => setShown(''), 0)
    }

    const timer = setInterval(() => {
      idx = Math.min(idx + charsPerTick, text.length)
      setShown(text.slice(0, idx))
      if (idx >= text.length) {
        clearInterval(timer)
        if (!doneRef.current) {
          doneRef.current = true
          onDone?.()
        }
      }
    }, tickMs)

    return () => {
      if (tInit) clearTimeout(tInit)
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, charsPerTick, tickMs, instant])

  const isTyping = shown.length < text.length
  return (
    <div className="relative">
      <article className={className}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{shown}</ReactMarkdown>
      </article>
      {isTyping && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-4 w-[3px] translate-y-0.5 bg-cyan-300 align-middle gw-cursor-blink"
        />
      )}
    </div>
  )
}
