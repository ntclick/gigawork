'use client'

import Link from 'next/link'
import { Menu, MessageSquare, TrendingUp } from 'lucide-react'

import { useUI } from './UIShell'
import { WalletPill } from './WalletPill'

interface TopBarProps {
  title?: string
  /** Show the chat-toggle button on mobile (only meaningful on the workflow page). */
  showChatToggle?: boolean
}

export function TopBar({ title, showChatToggle }: TopBarProps) {
  const { toggleHistory, toggleChat } = useUI()

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-white/5 bg-[#0b0e15]/60 px-3 backdrop-blur sm:px-4">
      <div className="flex min-w-0 items-center gap-2 text-sm text-white/85">
        {/* Mobile-only hamburger to open history drawer */}
        <button
          type="button"
          onClick={toggleHistory}
          aria-label="Open history"
          className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-white/65 transition hover:bg-white/5 hover:text-white"
        >
          <Menu className="h-4 w-4" />
        </button>

        {title ? (
          <span className="truncate">{title}</span>
        ) : (
          <span className="truncate text-[10px] uppercase tracking-widest text-white/40">
            Hermes brain · 5 agents · ERC-8004
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Link
          href="/signals"
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.2)] transition hover:bg-amber-500/20 hover:border-amber-400"
        >
          <TrendingUp className="h-3.5 w-3.5 text-amber-400" />
          <span className="hidden sm:inline">Coin Signals 📈</span>
        </Link>
        <WalletPill />
      </div>
    </header>
  )
}
