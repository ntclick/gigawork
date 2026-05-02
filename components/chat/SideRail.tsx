'use client'

import { Network, ScrollText, Wallet } from 'lucide-react'

export function SideRail({
  onCanvas,
  onLogs,
  canvasOpen,
}: {
  onCanvas: () => void
  onLogs?: () => void
  canvasOpen?: boolean
}) {
  return (
    <aside className="fixed top-0 right-0 z-20 hidden h-full w-9 flex-col items-center gap-1 border-l border-white/8 bg-[#0f131c]/80 py-4 backdrop-blur md:flex">
      <RailButton
        active={canvasOpen}
        onClick={onCanvas}
        title="Canvas"
        icon={<Network className="h-4 w-4" />}
      />
      <RailButton
        onClick={onLogs}
        title="Logs"
        icon={<ScrollText className="h-4 w-4" />}
      />
      <RailButton
        disabled
        title="Wallet (v2)"
        icon={<Wallet className="h-4 w-4" />}
      />
    </aside>
  )
}

function RailButton({
  active,
  disabled,
  onClick,
  title,
  icon,
}: {
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  title: string
  icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`relative rounded-md p-1.5 transition ${
        disabled
          ? 'text-white/15'
          : active
            ? 'bg-cyan-400/15 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.3)]'
            : 'text-white/55 hover:bg-white/5 hover:text-white/95'
      }`}
    >
      {icon}
      {active && <span className="absolute -left-px top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-cyan-300" />}
    </button>
  )
}
