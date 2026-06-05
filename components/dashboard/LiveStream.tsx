import React, { useEffect, useRef, useState } from 'react'
import { Terminal, RefreshCw, AlertCircle, Play, Sparkles } from 'lucide-react'
import { RequestLog } from '@/lib/chain/nanopayments'

interface LiveStreamProps {
  logs: RequestLog[]
  onClear: () => void
  isPolling: boolean
  onTogglePolling: () => void
}

export function LiveStream({
  logs,
  onClear,
  isPolling,
  onTogglePolling,
}: LiveStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalEndRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [logs, autoScroll])

  const getStatusColor = (status: number) => {
    if (status === 200) return 'text-emerald-400 font-bold'
    if (status === 402) return 'text-amber-400 font-semibold'
    return 'text-rose-400 font-bold'
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toTimeString().split(' ')[0]
  }

  return (
    <div className="flex flex-col h-[400px] bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden shadow-2xl relative">
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-850">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-cyan-400 animate-pulse" />
          <span className="font-mono text-xs text-slate-200 tracking-wider font-bold">
            M2M REQUEST STREAM (LIVE)
          </span>
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-950/40 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            {isPolling ? 'STREAMING' : 'PAUSED'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onTogglePolling}
            title={isPolling ? 'Pause' : 'Resume'}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
          >
            <Play className={`h-3.5 w-3.5 ${isPolling ? 'rotate-90 text-amber-500' : 'text-emerald-500'}`} />
          </button>
          <button
            onClick={onClear}
            className="font-mono text-[10px] px-2 py-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 border border-slate-800 rounded transition"
          >
            CLEAR LOGS
          </button>
          <label className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded bg-slate-900 border-slate-800 text-cyan-500 focus:ring-0"
            />
            AUTO-SCROLL
          </label>
        </div>
      </div>

      {/* Terminal Log Console */}
      <div ref={containerRef} className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
            <AlertCircle className="h-6 w-6 text-slate-650" />
            <p className="text-center max-w-xs text-[11px] uppercase tracking-wide">
              No machine-to-machine requests captured yet. Call endpoints like <code className="text-cyan-500">/api/agents/crypto-scanner</code> to trigger logs.
            </p>
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="hover:bg-slate-900/40 py-0.5 px-1 rounded transition flex items-start gap-2">
              <span className="text-slate-500 shrink-0 select-none">[{formatTime(log.timestamp)}]</span>
              <span className="text-cyan-500 shrink-0 font-bold select-none">[{log.clientIp === '::1' || log.clientIp === '127.0.0.1' ? 'LOCAL' : 'REMOTE'}]</span>
              <span className="text-purple-400 shrink-0 max-w-[80px] truncate select-none" title={log.buyer}>
                {log.buyer && log.buyer.startsWith('0x') ? `${log.buyer.slice(0, 6)}...${log.buyer.slice(-4)}` : log.buyer}
              </span>
              <span className={`${getStatusColor(log.status)} shrink-0`}>
                {log.status === 200 ? '✔ 200' : log.status === 402 ? '⚠ 402' : '✖ ' + log.status}
              </span>
              <span className="text-slate-350 break-all">{log.message}</span>
            </div>
          ))
        )}
        <div ref={terminalEndRef} />
      </div>

      {/* Retro scanline design effect overlay */}
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_bottom,rgba(255,255,255,0.005)_50%,rgba(0,0,0,0.02)_50%)] bg-[length:100%_4px] pointer-events-none opacity-40" />
    </div>
  )
}
