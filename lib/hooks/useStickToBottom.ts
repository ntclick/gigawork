'use client'

/**
 * useStickToBottom — terminal-style auto-scroll.
 *
 * Follows new output while the user is at the bottom, and gets out of the
 * way the moment they scroll up to read something. Returns the count of
 * lines that arrived while detached so the caller can offer a "jump to
 * latest" affordance.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const BOTTOM_THRESHOLD_PX = 24

export function useStickToBottom(itemCount: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [stuck, setStuck] = useState(true)
  const [missed, setMissed] = useState(0)
  const lastCountRef = useRef(itemCount)

  const scrollToBottom = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setStuck(true)
    setMissed(0)
  }, [])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX
    setStuck(atBottom)
    if (atBottom) setMissed(0)
  }, [])

  // Layout effect so the scroll lands in the same frame as the new line —
  // avoids a visible jump.
  useLayoutEffect(() => {
    const added = itemCount - lastCountRef.current
    lastCountRef.current = itemCount
    if (added <= 0) return
    if (stuck) {
      const el = ref.current
      if (el) el.scrollTop = el.scrollHeight
    } else {
      setMissed((n) => n + added)
    }
  }, [itemCount, stuck])

  // `End` re-attaches, matching terminal muscle memory.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'End') scrollToBottom()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scrollToBottom])

  return { ref, stuck, missed, onScroll, scrollToBottom }
}
