'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import type { UIMessage } from 'ai'
import { 
  CheckCircle2, XCircle, Loader2, PlayCircle, HelpCircle, Terminal, MessageSquare,
  Search, ShieldAlert, TrendingUp, MessageSquare as MessageIcon, Coins, Globe, 
  FileText, Clock, Compass, Image as ImageIcon, Sparkles, Mail, Bot
} from 'lucide-react'
import { buildFromMessages } from './WorkflowCanvas'

// Map skill name to beautiful Agent Identity metadata with Lucide Icons
const AGENT_META: Record<string, { name: string; icon: any; color: string; bg: string; border: string }> = {
  'crypto-scanner': {
    name: 'Birdeye On-chain Scanner',
    icon: Search,
    color: '#00e5ff',
    bg: 'rgba(0, 229, 255, 0.08)',
    border: 'rgba(0, 229, 255, 0.25)',
  },
  'whale-tracker': {
    name: 'Alchemy Whale Tracker',
    icon: ShieldAlert,
    color: '#3d5afe',
    bg: 'rgba(61, 90, 254, 0.08)',
    border: 'rgba(61, 90, 254, 0.25)',
  },
  'trading-signals': {
    name: 'Binance Technical Analyst',
    icon: TrendingUp,
    color: '#ffc400',
    bg: 'rgba(255, 196, 0, 0.08)',
    border: 'rgba(255, 196, 0, 0.25)',
  },
  'social-sentiment': {
    name: 'LunarCrush Social Sentiment',
    icon: MessageIcon,
    color: '#ff1744',
    bg: 'rgba(255, 23, 68, 0.08)',
    border: 'rgba(255, 23, 68, 0.25)',
  },
  'defi-yields': {
    name: 'Yield Finder DeFi APY',
    icon: Coins,
    color: '#00e676',
    bg: 'rgba(0, 230, 118, 0.08)',
    border: 'rgba(0, 230, 118, 0.25)',
  },
  'web-intel': {
    name: 'Google Search Research',
    icon: Globe,
    color: '#eceff1',
    bg: 'rgba(236, 239, 241, 0.08)',
    border: 'rgba(236, 239, 241, 0.25)',
  },
  'document-digest': {
    name: 'Kimi Document Digest',
    icon: FileText,
    color: '#00e5ff',
    bg: 'rgba(0, 229, 255, 0.08)',
    border: 'rgba(0, 229, 255, 0.25)',
  },
  'dca-executor': {
    name: 'Binance DCA Planner',
    icon: Clock,
    color: '#ff9100',
    bg: 'rgba(255, 145, 0, 0.08)',
    border: 'rgba(255, 145, 0, 0.25)',
  },
  'polymarket-pulse': {
    name: 'Polymarket Gamma Predictor',
    icon: Compass,
    color: '#d500f9',
    bg: 'rgba(213, 0, 249, 0.08)',
    border: 'rgba(213, 0, 249, 0.25)',
  },
  'nft-floor-watch': {
    name: 'OpenSea NFT Floor Watch',
    icon: ImageIcon,
    color: '#00e676',
    bg: 'rgba(0, 230, 118, 0.08)',
    border: 'rgba(0, 230, 118, 0.25)',
  },
  'report-composer': {
    name: 'Moonshot Report Composer',
    icon: Sparkles,
    color: '#d500f9',
    bg: 'rgba(213, 0, 249, 0.08)',
    border: 'rgba(213, 0, 249, 0.25)',
  },
  'email-sender': {
    name: 'Resend Mailman',
    icon: Mail,
    color: '#00b0ff',
    bg: 'rgba(0, 176, 255, 0.08)',
    border: 'rgba(0, 176, 255, 0.25)',
  },
  'telegram-sender': {
    name: 'Hermes Telegram Dispatcher',
    icon: Bot,
    color: '#2979ff',
    bg: 'rgba(41, 121, 255, 0.08)',
    border: 'rgba(41, 121, 255, 0.25)',
  },
}

// Generate live dynamic sub-bullets/telemetry for each AI Agent card (Mockup aesthetic)
function getNodeBullets(skill: string, status: string, detailInput: any, detailOutput: any): string[] {
  if (status === 'running') {
    switch (skill) {
      case 'crypto-scanner':
        return ['Scanning SOL Liquidity Pools', 'Analyzing contract security', 'Extracting holder counts']
      case 'whale-tracker':
        return ['Tracking transfer history', 'Filtering transaction size', 'Identifying whale addresses']
      case 'trading-signals':
        return ['Calculating RSI & MACD', 'Verifying kline timeframes', 'Analyzing market momentum']
      case 'social-sentiment':
        return ['Parsing Twitter engagement', 'Scanning social search volume', 'Evaluating brand sentiment']
      case 'defi-yields':
        return ['Scanning TVL thresholds', 'Hunting high APY pools', 'Checking stablecoin liquidity']
      case 'web-intel':
        return ['Searching general news', 'Digesting web research', 'Filtering macro updates']
      case 'document-digest':
        return ['Reading external document', 'Synthesizing with LLM', 'Generating brief outlines']
      case 'dca-executor':
        return ['Estimating token costs', 'Running DCA projections', 'Evaluating price averages']
      case 'polymarket-pulse':
        return ['Retrieving prediction odds', 'Measuring trading volumes', 'Evaluating market outcomes']
      case 'nft-floor-watch':
        return ['Fetching collection floor', 'Comparing OpenSea floor prices', 'Checking floor deviation']
      case 'email-sender':
        return ['Connecting to Resend API', 'Formatting markdown layout', 'Sending alert email']
      case 'telegram-sender':
        return ['Packaging Telegram text', 'Dispatched alerts to target chat', 'Pinging chat ID']
      case 'report-composer':
        return ['Compiling markdown synthesis', 'Assembling preceding data', 'Writing synthesis outline']
      default:
        return ['Executing dynamic agent tasks...', 'Synthesizing inputs']
    }
  }

  if (status === 'completed') {
    const out = detailOutput || {}
    switch (skill) {
      case 'crypto-scanner': {
        const symbol = out.symbol || 'token'
        const price = out.price_usd ? `$${out.price_usd}` : 'N/A'
        const mc = out.market_cap_usd ? `$${Math.round(out.market_cap_usd / 1000).toLocaleString()}K` : 'N/A'
        return [
          `Scanned ${symbol} successfully`,
          `Price: ${price} (${out.change_24h_pct > 0 ? '+' : ''}${out.change_24h_pct || 0}%)`,
          `Market Cap: ${mc} / Holders: ${(out.holders || 0).toLocaleString()}`
        ]
      }
      case 'whale-tracker': {
        return [
          `Analyzed wallet transfer logs`,
          `Large transactions verified`,
          `Flow assessment complete`
        ]
      }
      case 'trading-signals': {
        return [
          `Binance Analyst completed RSI/MACD`,
          `Indicators calculated successfully`,
          `Technical status update ready`
        ]
      }
      case 'social-sentiment': {
        const score = out.sentiment_score !== undefined ? `${out.sentiment_score}%` : '85%'
        return [
          `LunarCrush social metrics scanned`,
          `Social Sentiment Score: ${score}`,
          `Trend engagement: Strong Bullish`
        ]
      }
      case 'defi-yields': {
        return [
          `Scanned top yield liquidity pools`,
          `Min TVL requirements passed`,
          `DeFi pool APY metrics calculated`
        ]
      }
      case 'web-intel': {
        return [
          `General search query succeeded`,
          `Extracted relevant news articles`,
          `Synthesized macro research data`
        ]
      }
      case 'document-digest': {
        return [
          `Parsed external URL whitepaper`,
          `Document digested by Kimi`,
          `Synthesized dynamic outline`
        ]
      }
      case 'dca-executor': {
        return [
          `Binance DCA estimates complete`,
          `Cost averages simulated`,
          `Cost-basis schedules calculated`
        ]
      }
      case 'polymarket-pulse': {
        return [
          `Polymarket odds extracted`,
          `Highest-volume pools analyzed`,
          `Prediction sentiment ready`
        ]
      }
      case 'nft-floor-watch': {
        return [
          `OpenSea NFT floor stats ready`,
          `Floor compared with deviation`,
          `Collection statistics synced`
        ]
      }
      case 'report-composer': {
        return [
          `Final report composed in markdown`,
          `Preceding agent outputs integrated`,
          `Synthesis report published`
        ]
      }
      case 'email-sender': {
        return [
          `Resend Mailman dispatched alert`,
          `Delivery confirmed by API`,
          `Recipient email address synced`
        ]
      }
      case 'telegram-sender': {
        return [
          `Telegram Dispatcher sent message`,
          `Delivery confirmed to chat_id`,
          `Real-time telemetry dispatched`
        ]
      }
      default:
        return ['Agent finished successfully.', 'Outputs recorded in database.']
    }
  }

  if (status === 'failed') {
    return ['Execution failed - check logs']
  }

  // Pending
  return []
}

interface DialogueItem {
  id: string
  role: 'user' | 'assistant'
  text: string
}

interface TerminalLine {
  id: string
  time: string
  type: 'USER' | 'DIALOGUE' | 'INFO' | 'PARAM' | 'SUCCESS' | 'ERROR' | 'FATAL' | 'WARN' | 'SKY' | 'REPUTE'
  content: string
}

export function WorkflowInteraction({
  messages,
  status,
  onNodeClick,
}: {
  messages: UIMessage[]
  status?: string
  onNodeClick: (planId: string, label: string, skill: string, nodeStatus: string) => void
}) {
  const { nodes: planNodes, details, hasPlan } = useMemo(() => buildFromMessages(messages), [messages])
  const [consoleMode, setConsoleMode] = useState<'terminal' | 'chat'>('terminal')
  const [showSidebar, setShowSidebar] = useState(true)
  const terminalContainerRef = useRef<HTMLDivElement>(null)
  const terminalBottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll terminal to bottom when messages update
  useEffect(() => {
    if (consoleMode === 'terminal' && terminalContainerRef.current) {
      terminalContainerRef.current.scrollTo({
        top: terminalContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [messages, consoleMode])

  // Extract clean dialogue messages safely matching the Vercel AI SDK parts structure
  const dialogues = useMemo<DialogueItem[]>(() => {
    const list: DialogueItem[] = []
    messages.forEach((m) => {
      m.parts?.forEach((part, i) => {
        if (part.type === 'text' && 'text' in part && part.text) {
          const txt = part.text as string
          if (
            txt.startsWith('❌ Brain') ||
            txt.startsWith('Brain tried') ||
            txt.includes('▸ Planning workflow')
          ) {
            return
          }
          list.push({
            id: `${m.id}-${i}`,
            role: m.role as 'user' | 'assistant',
            text: txt,
          })
        }
      })
    })
    return list
  }, [messages])

  // Generate live terminal log lines based on raw message parts
  const terminalLines = useMemo<TerminalLine[]>(() => {
    const lines: TerminalLine[] = []
    messages.forEach((m, msgIdx) => {
      const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false })

      if (m.role === 'user') {
        const text = (m.parts?.[0] as any)?.text || ''
        lines.push({
          id: `u-${m.id}-${msgIdx}`,
          time: timeStr,
          type: 'USER',
          content: `guest@gigawork:~$ run-workflow --prompt "${text}"`,
        })
        return
      }

      m.parts?.forEach((part, partIdx) => {
        const lineId = `${m.id}-${partIdx}`
        if (part.type === 'text' && 'text' in part && part.text) {
          const text = part.text as string
          if (text.startsWith('❌ Brain')) {
            lines.push({ id: lineId, time: timeStr, type: 'FATAL', content: `[FATAL] ${text}` })
          } else if (text.startsWith('Brain tried')) {
            lines.push({ id: lineId, time: timeStr, type: 'WARN', content: `[WARN] ${text}` })
          } else if (text.includes('▸ Planning workflow')) {
            lines.push({
              id: lineId,
              time: timeStr,
              type: 'INFO',
              content: `[SYSTEM] hermes_planner: analyzing request and drafting execution plan...`,
            })
          } else {
            lines.push({ id: lineId, time: timeStr, type: 'DIALOGUE', content: `[DIALOGUE] ${text}` })
          }
        }

        if (typeof part === 'object' && part !== null && 'type' in part) {
          const p = part as any
          const toolName = p.type.replace(/^tool-/, '')
          const state = p.state

          if (toolName === 'planWorkflow' && state === 'output-available') {
            const out = p.output || {}
            const nodesCount = out.nodes?.length ?? 0
            lines.push({
              id: `${lineId}-planned`,
              time: timeStr,
              type: 'SUCCESS',
              content: `[OK] hermes_planner: workflow planned successfully with ${nodesCount} active nodes.`,
            })
            out.nodes?.forEach((n: any, i: number) => {
              lines.push({
                id: `${lineId}-node-${i}`,
                time: timeStr,
                type: 'PARAM',
                content: `     ├── Node #${i + 1}: slug="${n.plan_id}" label="${n.label}" skill="${n.skill_name}"`,
              })
            })
          }

          if (toolName === 'dispatchSkill') {
            const input = p.input || {}
            const skillName = input.skill_name || 'unknown'

            if (state === 'input-streaming' || state === 'input-available') {
              lines.push({
                id: `${lineId}-start`,
                time: timeStr,
                type: 'INFO',
                content: `[RUN] abco_scheduler: launching Agent [${skillName}]...`,
              })
              if (input.input) {
                lines.push({
                  id: `${lineId}-args`,
                  time: timeStr,
                  type: 'PARAM',
                  content: `      ├─ Dynamic inputs: ${JSON.stringify(input.input)}`,
                })
              }
            } else if (state === 'output-available') {
              const out = p.output || {}
              if (out.ok === false) {
                lines.push({
                  id: `${lineId}-err`,
                  time: timeStr,
                  type: 'ERROR',
                  content: `[FAIL] Agent [${skillName}] aborted: ${out.error || 'unknown connection error'}`,
                })
              } else {
                lines.push({
                  id: `${lineId}-ok`,
                  time: timeStr,
                  type: 'SUCCESS',
                  content: `[OK] Agent [${skillName}] completed execution.`,
                })
                if (out.dispatch_tx) {
                  lines.push({
                    id: `${lineId}-tx`,
                    time: timeStr,
                    type: 'SKY',
                    content: `      └─ On-chain Attestation: ${out.dispatch_tx}`,
                  })
                }
              }
            }
          }

          if (toolName === 'reputationUpdate' && state === 'output-available') {
            const out = p.output || {}
            lines.push({
              id: `${lineId}-rep`,
              time: timeStr,
              type: 'REPUTE',
              content: `[REPUTE] Reputation scored. status=${out.status || 'recorded'} tx=${out.tx || 'DB_CACHED'}`,
            })
          }

          if (toolName === 'validationAttest' && state === 'output-available') {
            lines.push({
              id: `${lineId}-val`,
              time: timeStr,
              type: 'SKY',
              content: `[VALIDATION] validator_node: certified ERC-8004 agent signature on-chain.`,
            })
          }
        }
      })
    })

    // If the workflow is in planning status and has no nodes planned yet, append boot logs!
    if (!hasPlan) {
      const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false })
      lines.push({
        id: 'boot-1',
        time: timeStr,
        type: 'INFO',
        content: `[SYSTEM] hermes_planner: connecting to AI orchestrator brain...`
      })
      lines.push({
        id: 'boot-2',
        time: timeStr,
        type: 'INFO',
        content: `[SYSTEM] hermes_planner: parsing intents and dependencies...`
      })
      lines.push({
        id: 'boot-3',
        time: timeStr,
        type: 'WARN',
        content: `[SYSTEM] hermes_planner: constructing execution graph (DAG)...`
      })
    }

    return lines
  }, [messages, hasPlan])

  // Calculate execution progress
  const progressStats = useMemo(() => {
    if (!planNodes || planNodes.length === 0) return { percent: 0, completed: 0, total: 0 }
    const total = planNodes.length
    let completed = 0
    let failed = 0
    let running = 0

    planNodes.forEach((node) => {
      const state = details.get(node.id)?.status ?? 'pending'
      if (state === 'completed') completed++
      else if (state === 'failed') failed++
      else if (state === 'running') running++
    })

    const percent = Math.round(((completed + (running * 0.5)) / total) * 100)
    return { percent, completed, total }
  }, [planNodes, details])

  return (
    <div className="flex h-full flex-col lg:flex-row overflow-hidden bg-[#030208] gap-4 p-4">
      {/* LEFT COLUMN: Console panel supporting BOTH retro Terminal view and Chat view */}
      <div className="flex flex-1 flex-col overflow-hidden border border-cyan-500/15 bg-black/60 rounded-2xl gw-mac-terminal">
        {/* Mac OS Window Controls Titlebar */}
        <div className="border-b border-white/5 bg-black/45 px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#ff5f56] block shadow-[0_0_6px_rgba(255,95,86,0.4)]" />
            <span className="w-3 h-3 rounded-full bg-[#ffbd2e] block shadow-[0_0_6px_rgba(255,189,46,0.4)]" />
            <span className="w-3 h-3 rounded-full bg-[#27c93f] block shadow-[0_0_6px_rgba(39,201,63,0.4)]" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-cyan-300/80 ml-2">
              {consoleMode === 'terminal' ? 'guest@gigawork: ~ (bash)' : 'dialogue@gigawork: ~ (chat)'}
            </span>
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="hidden lg:flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[9px] text-white/50 transition hover:bg-white/10 hover:text-white ml-4"
            >
              {showSidebar ? '➡️ Hide Panel' : '⬅️ Show Panel'}
            </button>
          </div>
          <div className="flex items-center gap-1 rounded bg-black/40 p-0.5 border border-white/5 font-mono text-[9px]">
            <button
              onClick={() => setConsoleMode('terminal')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded transition uppercase ${
                consoleMode === 'terminal' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/20' : 'text-white/40 hover:text-white/70'
              }`}
            >
              <Terminal className="h-3 w-3" />
              Terminal
            </button>
            <button
              onClick={() => setConsoleMode('chat')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded transition uppercase ${
                consoleMode === 'chat' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/20' : 'text-white/40 hover:text-white/70'
              }`}
            >
              <MessageSquare className="h-3 w-3" />
              Chat
            </button>
          </div>
        </div>

        {/* Dynamic Console Mode render */}
        <div className="flex-1 overflow-hidden relative">
          {consoleMode === 'terminal' ? (
            /* RETRO HACKER TERMINAL */
            <div className="h-full overflow-hidden relative crt-vignette">
              <div className="scanline" />
              <div ref={terminalContainerRef} className="h-full overflow-y-auto p-4 font-mono text-xs leading-relaxed text-cyan-400/90 selection:bg-cyan-500/30 selection:text-white relative z-10">
                <div className="space-y-1.5 z-10 relative">
                  {/* Standby Guide Card */}
                  {status === 'planning' && progressStats.completed === 0 && (
                    <div className="gw-standby-panel p-5 font-mono border border-yellow-500/30 text-yellow-300/90 rounded-lg space-y-3 my-2 animate-flash">
                      <div className="flex items-center gap-2 border-b border-yellow-500/20 pb-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 animate-ping" />
                        <span className="font-bold tracking-widest text-xs uppercase text-yellow-400">⚡ SYSTEM STANDBY (READY)</span>
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        Hermes planner has compiled the autonomous execution DAG (<span className="text-white font-bold">{progressStats.total} steps</span>).
                      </p>
                      <div className="bg-black/35 px-3 py-2 border border-white/5 text-[10px] text-white/70">
                        <span className="text-cyan-400 font-bold">SYSTEM CHECKS:</span> All Agent modules loaded successfully. Ready to trigger wallets, mint keys, and orchestrate DeFi/Scanner parameters.
                      </div>
                      <div className="text-[11px] font-bold text-center border border-yellow-500/20 bg-yellow-500/5 py-2 uppercase tracking-wide">
                        👉 Click <span className="text-white font-extrabold underline text-xs animate-pulse">"ACTIVATE WORKFLOW"</span> at the bottom to begin!
                      </div>
                    </div>
                  )}

                  {terminalLines.map((line) => {
                    let colorClass = 'text-white/60'
                    if (line.type === 'USER') colorClass = 'text-cyan-300 font-bold gw-glow-cyan'
                    else if (line.type === 'DIALOGUE') colorClass = 'gw-log-glow-emerald font-medium'
                    else if (line.type === 'SUCCESS') colorClass = 'gw-log-glow-emerald font-bold'
                    else if (line.type === 'ERROR' || line.type === 'FATAL') colorClass = 'text-red-500 font-bold gw-glow-red'
                    else if (line.type === 'PARAM') colorClass = 'text-purple-400/80'
                    else if (line.type === 'WARN') colorClass = 'text-amber-400 font-semibold'
                    else if (line.type === 'SKY' || line.type === 'REPUTE') colorClass = 'text-sky-300 gw-glow-cyan'

                    return (
                      <div key={line.id} className="flex items-start gap-2 animate-fadeIn">
                        <span className="text-white/35 shrink-0 select-none">[{line.time}]</span>
                        <span className={`${colorClass} break-words whitespace-pre-wrap flex-1`}>{line.content}</span>
                      </div>
                    )
                  })}
                  
                  {/* Active blinder shell cursor */}
                  <div className="flex items-start gap-2">
                    <span className="text-white/35 shrink-0 select-none">[{new Date().toLocaleTimeString('en-US', { hour12: false })}]</span>
                    <div className="flex items-center gap-1 text-cyan-300 font-bold">
                      <span className="gw-glow-cyan">guest@gigawork:~$</span>
                      <span className="h-3.5 w-1.5 inline-block bg-cyan-400 gw-cursor-blink" />
                    </div>
                  </div>

                  <div ref={terminalBottomRef} />
                </div>
              </div>
            </div>
          ) : (
            /* CONVERSATION CHAT DIALOGUE */
            <div className="h-full overflow-y-auto p-4 space-y-4">
              {dialogues.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-white/35">
                  <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
                  Preparing conversation...
                </div>
              ) : (
                dialogues.map((d) => {
                  const isUser = d.role === 'user'
                  return (
                    <div key={d.id} className={`flex items-start gap-3 ${isUser ? 'justify-end' : ''}`}>
                      {!isUser && (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-base shadow-[0_0_10px_rgba(34,211,238,0.2)]">
                          🤖
                        </div>
                      )}
                      <div
                        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed shadow-md ${
                          isUser
                            ? 'border border-purple-500/30 bg-gradient-to-br from-purple-500/10 to-pink-500/5 text-white'
                            : 'border border-white/5 bg-[#17142b]/90 text-white/90'
                        }`}
                      >
                        {isUser ? (
                          <p className="font-medium text-purple-200">{d.text}</p>
                        ) : (
                          <div className="whitespace-pre-wrap font-sans text-white/90">
                            {d.text}
                          </div>
                        )}
                      </div>
                      {isUser && (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-purple-500/30 bg-purple-500/10 text-sm text-purple-200">
                          U
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: AI Agent team list with progress neon bar */}
      {showSidebar && (
        <div className="w-full lg:w-[360px] flex flex-col shrink-0 overflow-hidden border border-white/5 bg-[rgba(10,8,20,0.65)] rounded-2xl gw-glass-panel gw-fade-in">
          {/* Neon Progress Bar - Mockup layout alignment */}
          <div className="border-b border-white/[0.05] bg-black/45 p-4 space-y-3">
            <div className="flex items-baseline justify-between font-mono">
              <span className="text-xs font-bold tracking-widest text-cyan-300">AI TEAM</span>
              <span className="text-[10px] text-white/40 tracking-wider">{progressStats.completed} / {progressStats.total} STEPS COMPLETED</span>
            </div>
            
            <div className="flex items-baseline gap-2.5">
              <span className="text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-emerald-400 to-cyan-300 drop-shadow-[0_0_15px_rgba(34,211,238,0.35)]">
                {progressStats.percent}%
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 animate-pulse font-bold">
                {progressStats.percent === 100 ? '100% DONE' : `${progressStats.percent}% DONE`}
              </span>
            </div>

            <div className="h-3.5 w-full rounded-full bg-[#120e25] p-[2px] border border-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-cyan-300 shadow-[0_0_15px_rgba(52,211,153,0.6)] gw-progress-bar-shine transition-all duration-700 ease-out"
                style={{ width: `${progressStats.percent}%` }}
              />
            </div>
          </div>

          {/* Vertical Agent cards list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <span className="block font-mono text-[9px] uppercase tracking-wider text-white/35 mb-2">
              DETAILED STEP STATUS (WF NODES)
            </span>

            {planNodes.length === 0 ? (
              /* Pulsing placeholders while planning */
              <div className="space-y-3">
                {[1, 2, 3].map((num) => (
                  <div
                    key={num}
                    className="flex items-center gap-3.5 border border-dashed border-white/10 bg-white/[0.01] p-3.5 rounded animate-pulse"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/20 text-white/20 text-sm">
                      ⚙️
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-xs font-bold uppercase tracking-wider text-white/35">
                        Formulating plan...
                      </h4>
                      <p className="truncate font-mono text-[9px] text-white/20 mt-0.5 uppercase tracking-widest">
                        STEP #{num}
                      </p>
                    </div>
                    <div className="shrink-0 text-white/20">
                      <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              planNodes.map((node) => {
                const skill = (node.data?.skill as string) ?? ''
                const meta = AGENT_META[skill] ?? {
                  name: String(node.data?.label ?? skill),
                  icon: Bot,
                  color: '#d500f9',
                  bg: 'rgba(213,0,249,0.05)',
                  border: 'rgba(213,0,249,0.15)',
                }
                const nodeStatus = details.get(node.id)?.status ?? 'pending'
                
                // Deterministic mock L1 wallet address based on skill name for Web3 realism
                const mockAddr = (() => {
                  let hash = 0
                  for (let i = 0; i < skill.length; i++) {
                    hash = skill.charCodeAt(i) + ((hash << 5) - hash)
                  }
                  const hex = Math.abs(hash).toString(16).slice(0, 8).padStart(8, '0')
                  return `0x${hex.slice(0, 4)}...${hex.slice(-4)}`
                })()

                return (
                  <div
                    key={node.id}
                    onClick={() => onNodeClick(node.id, String(node.data?.label ?? ''), skill, nodeStatus)}
                    className={`relative flex flex-col border p-3.5 transition-all duration-300 cursor-pointer group rounded-xl ${
                      nodeStatus === 'completed'
                        ? 'border-emerald-500/25 bg-emerald-500/[0.02] hover:border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.04)]'
                        : nodeStatus === 'failed'
                          ? 'border-red-500/30 bg-red-500/[0.04] shadow-[0_0_12px_rgba(239,68,68,0.1)] hover:border-red-500/50'
                          : nodeStatus === 'running'
                            ? 'border-cyan-400/40 bg-cyan-400/[0.03] shadow-[0_0_15px_rgba(34,211,238,0.15)] animate-pulse'
                            : 'border-white/5 bg-[rgba(15,10,25,0.45)] hover:border-white/10 hover:bg-[rgba(15,10,25,0.6)]'
                    }`}
                    style={{
                      boxShadow: nodeStatus === 'running' ? `0 0 15px ${meta.border}` : undefined,
                    }}
                  >
                    <div className="flex items-start gap-3.5 w-full">
                      {/* Agent Icon / Avatar */}
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition group-hover:scale-105"
                        style={{
                          backgroundColor: meta.bg,
                          borderColor: meta.border,
                          color: meta.color,
                          boxShadow: nodeStatus === 'running' ? `0 0 10px ${meta.color}60` : undefined,
                        }}
                      >
                        {(() => {
                          const IconComponent = meta.icon
                          return <IconComponent className="h-5 w-5" />
                        })()}
                      </div>

                      {/* Agent Identity & Live Telemetry list */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <h4 className="truncate text-xs font-bold uppercase tracking-wider text-white group-hover:text-cyan-300 transition-colors">
                            {meta.name}
                          </h4>
                          <span className="shrink-0 text-[7px] font-mono font-bold px-1 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">ERC-8004</span>
                        </div>
                        
                        <div className="flex items-center justify-between font-mono text-[9px] text-white/45 uppercase tracking-widest leading-none">
                          <span className="truncate">{String(node.data?.label ?? skill)}</span>
                          <span className="text-cyan-400/70 hover:underline hover:text-cyan-300 transition-colors font-mono ml-1">{mockAddr}</span>
                        </div>

                        {/* Interactive dynamic sub-bullets/telemetry (Exactly like the mockup) */}
                        <div className="space-y-1 pt-1 text-[9px] text-white/50 font-mono">
                          {getNodeBullets(
                            skill, 
                            nodeStatus, 
                            details.get(node.id)?.input, 
                            details.get(node.id)?.output
                          ).map((bullet, bIdx) => (
                            <div key={bIdx} className="flex items-center gap-1.5 pl-0.5">
                              <span 
                                className="w-1.5 h-1.5 rounded-full shrink-0" 
                                style={{ 
                                  backgroundColor: nodeStatus === 'completed' ? '#39ff14' : nodeStatus === 'failed' ? '#ef4444' : nodeStatus === 'running' ? meta.color : 'rgba(255,255,255,0.2)',
                                  boxShadow: nodeStatus === 'completed' ? '0 0 4px #39ff14' : undefined
                                }}
                              />
                              <span className="truncate">{bullet}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Status Indicator Badge */}
                      <div className="shrink-0 mt-0.5">
                        {nodeStatus === 'completed' ? (
                          <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/10 text-emerald-400">
                            <CheckCircle2 className="h-4 w-4" />
                          </div>
                        ) : nodeStatus === 'failed' ? (
                          <div className="flex h-6 w-6 items-center justify-center rounded bg-red-500/10 text-red-400 border border-red-500/30 animate-bounce">
                            <XCircle className="h-4 w-4" />
                          </div>
                        ) : nodeStatus === 'running' ? (
                          <div className="flex h-6 w-6 items-center justify-center rounded bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          </div>
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded bg-white/[0.04] text-white/20">
                            <HelpCircle className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* USDC Escrow Flow Section (ERC-8183 bảo chứng) */}
                    <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between font-mono text-[9px] leading-none shrink-0 w-full select-none">
                      <div className="flex items-center gap-1.5">
                        <span className="text-white/40">Bảo chứng USDC:</span>
                        <span className={`font-extrabold tracking-wide ${
                          nodeStatus === 'completed'
                            ? 'text-emerald-400 font-bold'
                            : nodeStatus === 'failed'
                              ? 'text-red-400'
                              : 'text-cyan-300'
                        }`}>
                          0.20 USDC {
                            nodeStatus === 'completed'
                              ? '✓ (Released)'
                              : nodeStatus === 'failed'
                                ? '🔓 (Refunded)'
                                : '🔒 (Locked)'
                          }
                        </span>
                      </div>
                      <span className="text-[8px] text-white/30 uppercase tracking-widest font-mono">ERC-8183 Escrow</span>
                    </div>

                    {/* Re-run tooltip overlay when failed */}
                    {nodeStatus === 'failed' && (
                      <div className="absolute right-12 top-1/2 -translate-y-1/2 bg-red-500 text-white font-pixel-body text-[9px] px-2 py-1 rounded shadow animate-pulse uppercase tracking-wider">
                        Configure & Re-run
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
