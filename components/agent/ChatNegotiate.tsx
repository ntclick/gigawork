'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Send, DollarSign, Loader2 } from 'lucide-react'

interface SupabaseNegotiation {
  id: string
  job_id: string
  agent_id: string
  role: string
  message: string
  price_offer: string
  created_at: string
}

interface ChatMessage {
  id: string
  jobId: string | null
  agentId: string | null
  role: string | null
  message: string | null
  priceOffer: string | null
  createdAt: Date | null
  agentName: string | null
  agentWallet: string | null
}

interface ChatNegotiateProps {
  jobId: string
  activeAgentId: string
  activeRole: 'client' | 'provider'
  initialMessages: ChatMessage[]
  agents: Record<string, { name: string; walletAddress: string }>
}

export function ChatNegotiate({
  jobId,
  activeAgentId,
  activeRole,
  initialMessages,
  agents,
}: ChatNegotiateProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [inputText, setInputText] = useState('')
  const [priceOffer, setPriceOffer] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom on new messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Subscribe to real-time database changes via Supabase
  useEffect(() => {
    const channel = supabase
      .channel(`job-chat:${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'negotiations',
          filter: `job_id=eq.${jobId}`,
        },
        async (payload) => {
          const newMsg = payload.new as unknown as SupabaseNegotiation
          
          // Resolve sender agent details
          const senderAgent = agents[newMsg.agent_id] || { name: 'Unknown Agent', walletAddress: '' }
          
          const formattedMsg: ChatMessage = {
            id: newMsg.id,
            jobId: newMsg.job_id,
            agentId: newMsg.agent_id,
            role: newMsg.role,
            message: newMsg.message,
            priceOffer: newMsg.price_offer,
            createdAt: new Date(newMsg.created_at),
            agentName: senderAgent.name,
            agentWallet: senderAgent.walletAddress,
          }

          // Deduplicate message list
          setMessages((prev) => {
            if (prev.some((m) => m.id === formattedMsg.id)) return prev
            return [...prev, formattedMsg]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [jobId, agents])

  // Polling fallback in case realtime connection fails
  useEffect(() => {
    const refreshChat = async () => {
      try {
        const res = await fetch(`/api/negotiate/${jobId}`)
        if (res.ok) {
          const data = await res.json()
          const newMsgs = data.messages || []
          
          const formatted = newMsgs.map((newMsg: ChatMessage) => {
            const senderAgent = agents[newMsg.agentId || ''] || { name: newMsg.agentName || 'Unknown Agent', walletAddress: newMsg.agentWallet || '' }
            return {
              id: newMsg.id,
              jobId: newMsg.jobId,
              agentId: newMsg.agentId,
              role: newMsg.role,
              message: newMsg.message,
              priceOffer: newMsg.priceOffer,
              createdAt: newMsg.createdAt ? new Date(newMsg.createdAt) : null,
              agentName: senderAgent.name,
              agentWallet: senderAgent.walletAddress,
            }
          })

          setMessages((prev) => {
            const merged = [...prev]
            let changed = false
            for (const msg of formatted) {
              if (!merged.some((m) => m.id === msg.id)) {
                merged.push(msg)
                changed = true
              }
            }
            if (changed) {
              return merged.sort((a, b) => {
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
                return ta - tb
              })
            }
            return prev
          })
        }
      } catch (err) {
        console.error('Failed to poll negotiation chat:', err)
      }
    }

    const t = setInterval(refreshChat, 3000)
    return () => clearInterval(t)
  }, [jobId, agents])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim() && !priceOffer.trim()) return

    setSending(true)
    try {
      const res = await fetch('/api/negotiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          agentId: activeAgentId,
          role: activeRole,
          message: inputText,
          priceOffer: priceOffer ? parseFloat(priceOffer) : null,
        }),
      })

      if (res.ok) {
        setInputText('')
        setPriceOffer('')
      }
    } catch (err) {
      console.error('Failed to send message:', err)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-[500px] rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="border-b border-white/10 bg-white/[0.02] px-6 py-4">
        <h4 className="font-semibold text-white">Negotiation Chat</h4>
        <p className="text-xs text-white/40">Realtime room for budget alignment</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg) => {
          const isMe = msg.agentId === activeAgentId
          const senderName = msg.agentName || 'Agent'
          const roleLabel = msg.role === 'client' ? 'Client' : 'Provider'

          return (
            <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <span className="text-[10px] text-white/30 mb-1">
                {senderName} ({roleLabel})
              </span>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                  isMe
                    ? 'bg-cyan-500/10 border border-cyan-500/30 text-white'
                    : 'bg-white/5 border border-white/10 text-white/90'
                }`}
              >
                <p>{msg.message}</p>

                {/* Price Offer Card */}
                {msg.priceOffer && (
                  <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-black/30 border border-white/5 px-2 py-1 text-xs text-cyan-300 font-mono">
                    <DollarSign className="h-3 w-3" />
                    <span>Price Offer: {Number(msg.priceOffer).toFixed(2)} USDC</span>
                  </div>
                )}
              </div>
              <span className="text-[9px] text-white/20 mt-1">
                {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="border-t border-white/10 bg-white/[0.01] p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-white placeholder-white/30 focus:border-cyan-500 focus:outline-none"
          />

          <div className="relative w-32">
            <span className="absolute left-3 top-2.5 text-white/40 text-xs">$</span>
            <input
              type="number"
              step="any"
              value={priceOffer}
              onChange={(e) => setPriceOffer(e.target.value)}
              placeholder="Offer..."
              className="w-full rounded-xl border border-white/10 bg-white/5 pl-6 pr-3 py-2 text-xs text-white placeholder-white/30 focus:border-cyan-500 focus:outline-none font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={sending || (!inputText.trim() && !priceOffer.trim())}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500 text-black hover:bg-cyan-400 disabled:opacity-50 transition"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </form>
    </div>
  )
}
