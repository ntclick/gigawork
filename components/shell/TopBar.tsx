'use client'

import { Menu, MessageSquare } from 'lucide-react'

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
        {showChatToggle && (
          <button
            type="button"
            onClick={toggleChat}
            aria-label="Open chat"
            className="md:hidden inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2 text-[11px] font-medium text-cyan-200 transition hover:bg-cyan-400/20"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </button>
        )}
        <WalletPill />
      </div>
    </header>
  )
}
