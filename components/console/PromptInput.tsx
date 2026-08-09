'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The single input. Plain text runs a workflow; a leading `/` runs a
 * command. Up/Down walks local history, like a real shell.
 */
export function PromptInput({
  onSubmit,
  busy,
  placeholder = 'describe an objective, or /help',
}: {
  onSubmit: (value: string) => void
  busy?: boolean
  placeholder?: string
}) {
  const [value, setValue] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const ref = useRef<HTMLInputElement | null>(null)

  // Typing anywhere focuses the prompt — terminal behaviour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key.length === 1 || e.key === 'Enter') ref.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = () => {
    const v = value.trim()
    if (!v || busy) return
    setHistory((h) => [...h, v])
    setCursor(null)
    setValue('')
    onSubmit(v)
  }

  return (
    <div className="gwt-input-row">
      <span className="text-[var(--gw-cyan)]">›</span>
      <input
        ref={ref}
        className="gwt-input"
        value={value}
        disabled={busy}
        placeholder={busy ? 'working…' : placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (!history.length) return
            const next = cursor === null ? history.length - 1 : Math.max(0, cursor - 1)
            setCursor(next)
            setValue(history[next])
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (cursor === null) return
            const next = cursor + 1
            if (next >= history.length) {
              setCursor(null)
              setValue('')
            } else {
              setCursor(next)
              setValue(history[next])
            }
          }
        }}
        autoFocus
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  )
}
