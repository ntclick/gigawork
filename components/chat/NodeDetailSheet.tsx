'use client'

/**
 * NodeDetailSheet — bottom-slide or side drawer pixel panel showing one workflow node's
 * input/output JSON + agent link.
 * Includes n8n-style tabs: Output (test log), Input (edit JSON), Settings (metadata).
 */
import Link from 'next/link'
import { ChevronDown, Play, RotateCw, Settings, TerminalSquare, FileJson, X, FlaskConical, Loader2, MessageSquare, ExternalLink, ShieldCheck, Save, Check, AlertCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useSkills } from '@/lib/hooks/useSkills'

const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'

export interface NodeDetail {
  id: string
  label: string
  skill: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  input?: unknown
  output?: unknown
  startedAt?: number | null
  finishedAt?: number | null
}

export interface NodeEditRequest {
  nodeId: string
  originalSkill: string
  newSkill: string
  inputJson: string
  note: string
}

export function NodeDetailSheet({
  detail,
  onClose,
  workflowId,
  onNodeUpdated,
}: {
  detail: NodeDetail | null
  onClose: () => void
  workflowId?: string
  onNodeUpdated?: () => void
}) {
  if (!detail) return null
  return (
    <NodeDetailSheetInner 
      detail={detail} 
      onClose={onClose} 
      workflowId={workflowId} 
      onNodeUpdated={onNodeUpdated}
    />
  )
}

function NodeDetailSheetInner({
  detail,
  onClose,
  workflowId,
  onNodeUpdated,
}: {
  detail: NodeDetail
  onClose: () => void
  workflowId?: string
  onNodeUpdated?: () => void
}) {
  const [activeTab, setActiveTab] = useState<'output' | 'input' | 'settings'>('output')
  const { skills } = useSkills()
  const [draftSkill, setDraftSkill] = useState(detail.skill)
  
  const initialInputJson = useMemo(() => {
    try {
      return detail.input !== undefined ? JSON.stringify(detail.input, null, 2) : '{}'
    } catch {
      return '{}'
    }
  }, [detail.input])
  
  const [draftInput, setDraftInput] = useState(initialInputJson)
  const [draftNote, setDraftNote] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  
  // Test state
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'running' | 'done' | 'error'
    data?: any
    error?: string
  }>({ status: 'idle' })

  // ─── Telegram bot config ─────────────────────────────────
  // 'saved' = use the token from /settings profile
  // 'custom' = user pastes a one-off token for this node
  type TgBotSource = 'saved' | 'custom'
  const [tgBotSource, setTgBotSource] = useState<TgBotSource>('saved')
  const [tgCustomToken, setTgCustomToken] = useState('')
  const [tgCustomChatId, setTgCustomChatId] = useState('')
  const [tgShowToken, setTgShowToken] = useState(false)
  const [tgShowAdvancedChatId, setTgShowAdvancedChatId] = useState(false)
  const [tgProfile, setTgProfile] = useState<{
    hasBotToken: boolean;
    masked: string | null;
    chatId: string | null;
  } | null>(null)

  const [savingProfile, setSavingProfile] = useState(false)
  const [saveProfileSuccess, setSaveProfileSuccess] = useState(false)
  const [saveProfileError, setSaveProfileError] = useState<string | null>(null)

  const handleSaveToProfile = async () => {
    const token = tgCustomToken.trim()
    const chatId = tgCustomChatId.trim()
    if (!token) {
      setSaveProfileError('Bot token cannot be empty')
      return
    }
    if (token.includes('••••')) {
      setSaveProfileError('Cannot save a redacted token')
      return
    }

    setSavingProfile(true)
    setSaveProfileError(null)
    setSaveProfileSuccess(false)

    try {
      const res = await fetch('/api/me/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramBotToken: token,
          telegramChatId: chatId || null,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to save to profile')
      }

      setSaveProfileSuccess(true)
      
      // Update local profile state
      if (data.profile) {
        setTgProfile({
          hasBotToken: !!data.profile.hasTelegramBotToken,
          masked: data.profile.telegramBotTokenMasked ?? null,
          chatId: data.profile.telegramChatId ?? null,
        })
      } else {
        setTgProfile({
          hasBotToken: true,
          masked: '••••' + token.slice(-4),
          chatId: chatId || null,
        })
      }

      // Switch back to saved bot mode after a successful save
      setTimeout(() => {
        setTgBotSource('saved')
        setSaveProfileSuccess(false)
      }, 1000)
    } catch (e) {
      setSaveProfileError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingProfile(false)
    }
  }

  // Fetch user profile once to know if a bot token is saved.
  useEffect(() => {
    fetch('/api/me/profile', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { profile?: { hasTelegramBotToken?: boolean; telegramBotTokenMasked?: string | null; telegramChatId?: string | null } }) => {
        const p = j.profile
        if (p) {
          setTgProfile({
            hasBotToken: !!p.hasTelegramBotToken,
            masked: p.telegramBotTokenMasked ?? null,
            chatId: p.telegramChatId ?? null,
          })
        }
      })
      .catch(() => {})
  }, [])

  // Reset form when detail changes
  useEffect(() => {
    setDraftSkill(detail.skill)
    setDraftInput(initialInputJson)
    setDraftNote('')
    setEditError(null)
    setTestResult({ status: 'idle' })
    
    // Prefill custom bot configurations if they exist in detail.input.
    // IMPORTANT: Never prefill masked/redacted values (e.g. "••••XXXX")
    // since they were redacted by the server and are not usable.
    const isMasked = (v: unknown): boolean =>
      typeof v === 'string' && v.includes('••••')
    
    // Try to load cached credentials from sessionStorage if available
    const cachedToken = typeof window !== 'undefined' ? sessionStorage.getItem(`tg_token_${detail.id}`) : null
    const cachedChatId = typeof window !== 'undefined' ? sessionStorage.getItem(`tg_chat_id_${detail.id}`) : null
    
    let isCustom = false
    let token = cachedToken || ''
    let cid = cachedChatId || ''
    
    if (cachedToken || cachedChatId) {
      isCustom = true
    }
    
    if (detail.input && typeof detail.input === 'object') {
      const inputObj = detail.input as Record<string, unknown>
      
      // Extract bot_token
      if (typeof inputObj.bot_token === 'string') {
        if (!isMasked(inputObj.bot_token)) {
          isCustom = true
          token = inputObj.bot_token
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(`tg_token_${detail.id}`, token)
          }
        } else {
          // If masked in DB, but we have a cached token, use the cached one!
          if (cachedToken) {
            isCustom = true
            token = cachedToken
          } else {
            // Masked but no cache: keep token empty, but still treat as custom
            isCustom = true
          }
        }
      }
      
      // Extract chat_id
      if (typeof inputObj.chat_id === 'string') {
        if (!isMasked(inputObj.chat_id)) {
          cid = inputObj.chat_id
          isCustom = true
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(`tg_chat_id_${detail.id}`, cid)
          }
        } else {
          if (cachedChatId) {
            isCustom = true
            cid = cachedChatId
          } else {
            isCustom = true
          }
        }
      }
    }
    
    setTgBotSource(isCustom ? 'custom' : 'saved')
    setTgCustomToken(token)
    setTgCustomChatId(cid)
    
    setTgShowToken(false)
    setActiveTab(detail.output ? 'output' : 'input')
  }, [detail.id, initialInputJson])

  // Save custom bot configurations to sessionStorage whenever they change
  // When bot token changes, clear cached chat_id so backend can auto-detect
  const prevTokenRef = useRef(tgCustomToken)
  useEffect(() => {
    if (typeof window !== 'undefined' && tgBotSource === 'custom') {
      const isMasked = (v: string): boolean => v.includes('••••')
      if (tgCustomToken && !isMasked(tgCustomToken)) {
        // If the token changed, clear stale chat_id cache
        if (prevTokenRef.current && prevTokenRef.current !== tgCustomToken) {
          sessionStorage.removeItem(`tg_chat_id_${detail.id}`)
          setTgCustomChatId('')
        }
        prevTokenRef.current = tgCustomToken
        sessionStorage.setItem(`tg_token_${detail.id}`, tgCustomToken.trim())
      }
      if (tgCustomChatId && !isMasked(tgCustomChatId)) {
        sessionStorage.setItem(`tg_chat_id_${detail.id}`, tgCustomChatId.trim())
      }
    }
  }, [tgCustomToken, tgCustomChatId, tgBotSource, detail.id])

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  /** Prepare the input object for a telegram-sender call:
   *  1. strip masked/redacted credentials
   *  2. inject custom bot_token / chat_id from the Settings tab when active */
  const prepareTelegramInput = (raw: Record<string, unknown>): Record<string, unknown> => {
    const obj = { ...raw }
    // Strip masked values
    for (const k of ['bot_token', 'api_key', 'authorization'] as const) {
      if (typeof obj[k] === 'string' && (obj[k] as string).includes('••••')) {
        delete obj[k]
      }
    }
    const effectiveSkill = draftSkill || detail.skill
    if (effectiveSkill === 'telegram-sender') {
      if (tgBotSource === 'custom') {
        if (tgCustomToken.trim()) obj.bot_token = tgCustomToken.trim()
        // Only send chat_id if the user explicitly typed a NEW value
        // that differs from the saved profile default.
        // If empty or same as profile → omit so backend auto-detects via getUpdates.
        const profileChatId = tgProfile?.chatId ?? ''
        const userChatId = tgCustomChatId.trim()
        if (userChatId && userChatId !== profileChatId) {
          obj.chat_id = userChatId
        } else {
          delete obj.chat_id
        }
      } else {
        // 'saved' mode: remove stale creds so server injects from profile
        delete obj.bot_token
        delete obj.chat_id
      }
    }
    return obj
  }

  const handleTest = async () => {
    if (!workflowId) return
    setTestResult({ status: 'running' })
    try {
      let parsedInput: Record<string, unknown> = {}
      if (draftInput.trim()) {
        parsedInput = JSON.parse(draftInput)
      }
      parsedInput = prepareTelegramInput(parsedInput)
      const res = await fetch(`/api/workflow/${workflowId}/test-node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: detail.id,
          skillName: draftSkill,
          input: parsedInput,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Test failed')
      }
      setTestResult({
        status: 'done',
        data: data.output,
      })
    } catch (e) {
      setTestResult({
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const [rerunning, setRerunning] = useState(false)

  const handleApplyEdit = async () => {
    if (!workflowId) return
    let parsedJson: Record<string, unknown> = {}
    const trimmed = draftInput.trim()
    if (trimmed) {
      try {
        parsedJson = JSON.parse(trimmed)
      } catch (e) {
        setEditError('Input JSON invalid: ' + (e instanceof Error ? e.message : 'parse error'))
        return
      }
    }

    parsedJson = prepareTelegramInput(parsedJson)

    setEditError(null)
    setRerunning(true)
    setTestResult({ status: 'running' })

    try {
      const res = await fetch(`/api/workflow/${workflowId}/test-node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: detail.id,
          skillName: draftSkill || detail.skill,
          input: parsedJson,
          save: true,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Re-run failed')
      }
      setTestResult({ status: 'done', data: data.output })
      setActiveTab('output')
      if (onNodeUpdated) {
        onNodeUpdated()
      }
    } catch (e) {
      setTestResult({
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      })
      setEditError(e instanceof Error ? e.message : String(e))
    } finally {
      setRerunning(false)
    }
  }

  const statusColor: Record<typeof detail.status, string> = {
    pending: 'border-white/30 bg-white/5 text-white/55',
    running: 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200',
    completed: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200',
    failed: 'border-red-400/50 bg-red-500/15 text-red-200',
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="gw-drawer-in-right flex w-full max-w-[500px] flex-col border-l-2 border-black bg-[var(--giga-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-black bg-[var(--giga-sidebar)] px-4 py-3">
          <div className="min-w-0 flex-1 truncate">
            <div className="text-[10px] uppercase tracking-wider text-white/55">
              Node {detail.id.slice(0, 8)}
            </div>
            <div className="truncate font-pixel-header text-[15px] text-white">
              {detail.label}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-3 inline-flex h-8 w-8 items-center justify-center text-white/55 transition-colors hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Status Bar */}
        <div className="flex flex-wrap items-center gap-2 border-b-2 border-black/50 bg-black/20 px-4 py-2">
          <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusColor[detail.status]}`}>
            {detail.status}
          </span>
          <Link
            href={`/agents/${detail.skill}`}
            className="border border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--giga-accent)] hover:bg-[var(--giga-accent)] hover:text-black"
          >
            {detail.skill}
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-black bg-[#12101f]">
          <TabButton
            active={activeTab === 'output'}
            onClick={() => setActiveTab('output')}
            icon={<TerminalSquare className="h-3.5 w-3.5" />}
            label="Output"
          />
          <TabButton
            active={activeTab === 'input'}
            onClick={() => setActiveTab('input')}
            icon={<FileJson className="h-3.5 w-3.5" />}
            label="Input"
          />
          <TabButton
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
            icon={<Settings className="h-3.5 w-3.5" />}
            label="Settings"
          />
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {activeTab === 'output' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white/70">Execution Output</h3>
                <button
                  onClick={handleTest}
                  disabled={testResult.status === 'running' || !workflowId}
                  className="flex items-center gap-1.5 border border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 px-3 py-1.5 text-[11px] font-bold text-[var(--giga-accent)] transition hover:bg-[var(--giga-accent)] hover:text-black disabled:opacity-50"
                >
                  {testResult.status === 'running' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  {testResult.status === 'running' ? 'Testing...' : 'Test this step'}
                </button>
              </div>

              {testResult.status === 'error' && (
                <div className="border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                  <span className="font-bold">Test Failed:</span> {testResult.error}
                </div>
              )}

              {testResult.data !== undefined ? (
                <CollapsibleJson label="Test Result" value={testResult.data} expanded={true} />
              ) : detail.output !== undefined ? (
                <CollapsibleJson
                  label={detail.status === 'failed' ? 'Error' : 'Output'}
                  value={detail.output}
                  expanded={true}
                  tone={detail.status === 'failed' ? 'error' : undefined}
                />
              ) : (
                <div className="rounded border border-dashed border-white/10 bg-white/[0.02] py-8 text-center">
                  <FlaskConical className="mx-auto mb-2 h-5 w-5 text-white/30" />
                  <p className="text-xs text-white/50">No output yet</p>
                  <p className="mt-1 text-[10px] text-white/30">
                    Click "Test this step" to run the skill directly.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'input' && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/70">Input Parameters</h3>
              <div>
                <label className="mb-1.5 block text-[11px] text-white/60">Edit JSON</label>
                <textarea
                  value={draftInput}
                  onChange={(e) => setDraftInput(e.target.value)}
                  rows={12}
                  className="w-full resize-y border-2 border-black bg-[#1f1f33] px-3 py-3 font-mono text-xs leading-relaxed text-emerald-300 placeholder:text-white/20 focus:border-[var(--giga-accent)] focus:outline-none"
                  spellCheck={false}
                />
              </div>
              {editError && (
                <div className="border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                  {editError}
                </div>
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/70">Node Settings</h3>
              
              <div>
                <label className="mb-1.5 block text-[11px] text-white/60">Provider (Skill)</label>
                <select
                  value={draftSkill}
                  onChange={(e) => setDraftSkill(e.target.value)}
                  className="w-full border-2 border-black bg-[#1f1f33] px-3 py-2.5 text-sm text-white focus:border-[var(--giga-accent)] focus:outline-none"
                >
                  {skills.length === 0 ? (
                    <option value={detail.skill}>{detail.skill}</option>
                  ) : (
                    skills.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.manifest.display_name ?? s.name} — {s.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* ═══ Telegram Bot Config (only when skill is telegram-sender) ═══ */}
              {(draftSkill || detail.skill) === 'telegram-sender' && (
                <div className="border border-cyan-400/20 bg-cyan-400/[0.03] p-4 space-y-3">
                  <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-cyan-300">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Telegram Bot
                  </h4>

                  {/* Radio: use saved vs custom */}
                  <div className="space-y-2">
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name="tg-bot-source"
                        checked={tgBotSource === 'saved'}
                        onChange={() => setTgBotSource('saved')}
                        className="mt-0.5 accent-cyan-400"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-white/85">
                          Use saved bot from Settings
                        </div>
                        {tgProfile ? (
                          tgProfile.hasBotToken ? (
                            <div>
                              <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                                <ShieldCheck className="h-3 w-3 text-emerald-400" />
                                <span className="font-mono text-emerald-300">{tgProfile.masked}</span>
                                {tgProfile.chatId && (
                                  <span className="text-white/40">· chat {tgProfile.chatId}</span>
                                )}
                              </div>
                              {!tgProfile.chatId && (
                                <div className="mt-1 text-[10px] text-cyan-300/85">
                                  No Chat ID saved — will auto-detect from the last user who messaged your bot.
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="mt-1 text-[10px] text-amber-300/80">
                              No bot token saved yet —{' '}
                              <a href="/settings" target="_blank" className="underline underline-offset-2 hover:text-amber-200">
                                go to Settings
                              </a>
                            </div>
                          )
                        ) : (
                          <div className="mt-1 text-[10px] text-white/40">Loading profile…</div>
                        )}
                      </div>
                    </label>

                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name="tg-bot-source"
                        checked={tgBotSource === 'custom'}
                        onChange={() => setTgBotSource('custom')}
                        className="mt-0.5 accent-cyan-400"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-white/85">
                          Use a different bot for this node
                        </div>
                        <div className="mt-0.5 text-[10px] text-white/40">
                          Paste a one-off token from{' '}
                          <a
                            href="https://t.me/BotFather"
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-300 underline-offset-2 hover:underline"
                          >
                            @BotFather <ExternalLink className="inline h-2.5 w-2.5" />
                          </a>
                        </div>
                      </div>
                    </label>
                  </div>

                  {/* Custom inputs (only when 'custom' selected) */}
                  {tgBotSource === 'custom' && (
                    <div className="space-y-2">
                      <div className="flex items-stretch gap-2">
                        <input
                          type={tgShowToken ? 'text' : 'password'}
                          value={tgCustomToken}
                          onChange={(e) => setTgCustomToken(e.target.value)}
                          placeholder="1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                          autoComplete="off"
                          className="flex-1 border-2 border-black bg-[#1f1f33] px-3 py-2 font-mono text-xs text-white placeholder:text-white/20 focus:border-cyan-400 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setTgShowToken((v) => !v)}
                          className="border-2 border-black bg-[#1f1f33] px-2.5 text-white/55 hover:text-white"
                          aria-label={tgShowToken ? 'Hide token' : 'Show token'}
                        >
                          {tgShowToken ? '🙈' : '👁'}
                        </button>
                      </div>
                      {!tgShowAdvancedChatId ? (
                        <button
                          type="button"
                          onClick={() => setTgShowAdvancedChatId(true)}
                          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300/70 transition hover:text-cyan-300"
                        >
                          <ChevronDown className="h-3 w-3" />
                          Tùy chọn: Gửi vào Chat ID khác
                        </button>
                      ) : (
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-wider text-white/50">
                            Chat ID (Tùy chọn)
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={tgCustomChatId}
                              onChange={(e) => setTgCustomChatId(e.target.value)}
                              placeholder="Để trống sẽ tự nhận diện..."
                              className="flex-1 border-2 border-black bg-[#1f1f33] px-3 py-2 font-mono text-xs text-white placeholder:text-white/20 focus:border-cyan-400 focus:outline-none"
                            />
                            <a
                              href="https://t.me/userinfobot"
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center justify-center gap-1 border-2 border-black bg-cyan-500/25 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/45 transition-colors whitespace-nowrap"
                            >
                              Get ID <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                          <div className="text-[10px] text-white/30">
                            Nếu để trống, bot sẽ tự động lấy Chat ID của người nhắn tin cuối cùng cho bot.
                          </div>
                        </div>
                      )}

                      {/* Save to Settings Button */}
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={handleSaveToProfile}
                          disabled={savingProfile || !tgCustomToken.trim() || tgCustomToken.includes('••••')}
                          className="flex w-full items-center justify-center gap-1.5 border border-cyan-400/50 bg-cyan-400/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-400 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {savingProfile ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : saveProfileSuccess ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          {savingProfile
                            ? 'Saving to Settings...'
                            : saveProfileSuccess
                            ? 'Saved to Settings! ✅'
                            : 'Save as Saved Bot (Global Settings)'}
                        </button>
                        {saveProfileError && (
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-red-400">
                            <AlertCircle className="h-3 w-3" />
                            <span>{saveProfileError}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-[11px] text-white/60">
                  Notes for Hermes <span className="text-white/30">(optional)</span>
                </label>
                <textarea
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  placeholder="e.g. use Solana instead of Ethereum..."
                  rows={4}
                  className="w-full resize-none border-2 border-black bg-[#1f1f33] px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:border-[var(--giga-accent)] focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {(activeTab === 'input' || activeTab === 'settings') && workflowId && (
          <div className="border-t-2 border-black bg-[var(--giga-sidebar)] p-4">
            {editError && (
              <div className="mb-3 border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {editError}
              </div>
            )}
            <button
              onClick={handleApplyEdit}
              disabled={rerunning}
              className="flex w-full items-center justify-center gap-2 border-2 border-black bg-[var(--giga-accent)] px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {rerunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
              {rerunning ? 'Re-running…' : 'Save & Re-run Node'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 border-r-2 border-black py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors last:border-r-0 ${
        active
          ? 'bg-[var(--giga-panel)] text-[var(--giga-accent)]'
          : 'text-white/40 hover:bg-[#1a1829] hover:text-white/70'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function CollapsibleJson({ label, value, expanded: defaultExpanded = false, tone }: { label: string; value: unknown; expanded?: boolean; tone?: 'error' }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  let formatted: string
  try {
    formatted = JSON.stringify(value, null, 2)
  } catch {
    formatted = String(value)
  }
  const lines = formatted.split('\n').length
  
  return (
    <div className="border border-black bg-[#0d0f14]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between bg-black/40 px-3 py-2 text-left text-[11px] uppercase tracking-wider text-white/65 hover:text-white"
      >
        <span className={tone === 'error' ? 'text-red-400' : 'text-emerald-400'}>{label}</span>
        <span className="flex items-center gap-1.5 text-[10px] text-white/45">
          {lines} lines
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {expanded && (
        <pre className="max-h-[50vh] overflow-auto p-3 font-mono text-[11px] leading-relaxed text-white/85">
          {formatted}
        </pre>
      )}
    </div>
  )
}
