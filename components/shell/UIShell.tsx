'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * UIShell — client-side context for transient UI state shared across the
 * (chat) layout: which mobile drawer is open. Lets TopBar's hamburger button,
 * the FAB on the workflow page, ChatPanel and HistorySidebar all coordinate
 * without prop-drilling through the server-rendered layout.
 */

type UIState = {
  historyOpen: boolean
  chatOpen: boolean
  openHistory: () => void
  closeHistory: () => void
  toggleHistory: () => void
  openChat: () => void
  closeChat: () => void
  toggleChat: () => void
}

const Ctx = createContext<UIState | null>(null)

export function useUI(): UIState {
  const v = useContext(Ctx)
  if (!v) {
    // Soft fallback so non-(chat) routes don't crash if a shared component
    // accidentally renders outside the provider.
    return {
      historyOpen: false,
      chatOpen: false,
      openHistory: () => {},
      closeHistory: () => {},
      toggleHistory: () => {},
      openChat: () => {},
      closeChat: () => {},
      toggleChat: () => {},
    }
  }
  return v
}

export function UIShell({ children }: { children: ReactNode }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  const openHistory = useCallback(() => setHistoryOpen(true), [])
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  const toggleHistory = useCallback(() => setHistoryOpen((v) => !v), [])
  const openChat = useCallback(() => setChatOpen(true), [])
  const closeChat = useCallback(() => setChatOpen(false), [])
  const toggleChat = useCallback(() => setChatOpen((v) => !v), [])

  // Lock body scroll while a drawer is open (mobile only — desktop stays
  // intact because the drawers themselves are hidden at md+ breakpoints).
  useEffect(() => {
    if (historyOpen || chatOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [historyOpen, chatOpen])

  // Close drawers on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (chatOpen) setChatOpen(false)
      else if (historyOpen) setHistoryOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chatOpen, historyOpen])

  return (
    <Ctx.Provider
      value={{
        historyOpen,
        chatOpen,
        openHistory,
        closeHistory,
        toggleHistory,
        openChat,
        closeChat,
        toggleChat,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
