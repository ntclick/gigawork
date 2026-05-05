'use client'

/**
 * Tiny pixel-style toast — no external dep.
 *
 * Use:
 *   import { toast } from '@/components/ui/toast'
 *   toast.error('Skill failed: …')
 *   toast.info('Workflow started')
 *
 * Mount <ToastHost /> once in the root layout. All toasts queue into a
 * single host; auto-dismiss after 5s, click X to dismiss earlier.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

type ToastKind = 'info' | 'success' | 'warning' | 'error'
interface ToastEvent {
  id: number
  kind: ToastKind
  message: string
  detail?: string
  durationMs?: number
}

const SUBSCRIBERS = new Set<(t: ToastEvent) => void>()
let nextId = 1

function emit(kind: ToastKind, message: string, detail?: string, durationMs?: number) {
  const ev: ToastEvent = { id: nextId++, kind, message, detail, durationMs }
  SUBSCRIBERS.forEach((cb) => cb(ev))
}

export const toast = {
  info: (message: string, detail?: string) => emit('info', message, detail),
  success: (message: string, detail?: string) => emit('success', message, detail),
  warning: (message: string, detail?: string) => emit('warning', message, detail),
  error: (message: string, detail?: string) => emit('error', message, detail, 8000),
}

export function ToastHost() {
  const [items, setItems] = useState<ToastEvent[]>([])

  useEffect(() => {
    const cb = (ev: ToastEvent) => {
      setItems((prev) => [...prev.slice(-4), ev])
      const ms = ev.durationMs ?? 5000
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== ev.id))
      }, ms)
    }
    SUBSCRIBERS.add(cb)
    return () => {
      SUBSCRIBERS.delete(cb)
    }
  }, [])

  if (items.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      {items.map((it) => (
        <ToastItem
          key={it.id}
          item={it}
          onClose={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
        />
      ))}
    </div>
  )
}

function ToastItem({ item, onClose }: { item: ToastEvent; onClose: () => void }) {
  const styles: Record<ToastKind, { border: string; bg: string; icon: React.ReactNode }> = {
    info: {
      border: 'border-cyan-400/50',
      bg: 'bg-cyan-500/10',
      icon: <Info className="h-4 w-4 text-cyan-300" />,
    },
    success: {
      border: 'border-emerald-400/50',
      bg: 'bg-emerald-500/10',
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-300" />,
    },
    warning: {
      border: 'border-amber-400/60',
      bg: 'bg-amber-500/10',
      icon: <AlertTriangle className="h-4 w-4 text-amber-300" />,
    },
    error: {
      border: 'border-red-400/60',
      bg: 'bg-red-500/10',
      icon: <XCircle className="h-4 w-4 text-red-300" />,
    },
  }
  const s = styles[item.kind]
  return (
    <div
      className={`pointer-events-auto flex max-w-md items-start gap-2 border-2 border-black ${s.border} ${s.bg} px-3 py-2 shadow-[4px_4px_0_0_#000]`}
      role="alert"
    >
      <span className="mt-0.5 shrink-0">{s.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white">{item.message}</div>
        {item.detail && (
          <div className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] text-white/65">
            {item.detail}
          </div>
        )}
      </div>
      <button
        onClick={onClose}
        className="shrink-0 text-white/45 hover:text-white"
        aria-label="dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
