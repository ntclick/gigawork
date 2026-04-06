const STATUS_STYLES: Record<string, string> = {
  IN_PROGRESS: 'bg-cyan-400/10 text-cyan-400 border-cyan-400/20',
  MATCHING: 'bg-cyan-400/10 text-cyan-400 border-cyan-400/20',
  PENDING_REVIEW: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
  SETTLED: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  DISPUTED: 'bg-red-400/10 text-red-400 border-red-400/20',
  EXPIRED: 'bg-red-400/10 text-red-400 border-red-400/20',
  OPEN: 'bg-white/5 text-gray-400 border-white/10',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold rounded border uppercase tracking-tight ${STATUS_STYLES[status] || 'bg-white/5 text-gray-400 border-white/10'}`}>
      {status}
    </span>
  )
}
