'use client'

import {
  Background,
  Controls,
  ControlButton,
  ReactFlow,
  Handle,
  Position,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileText,
  GitBranch,
  Hexagon,
  Maximize2,
  Play,
  Search,
  Send,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type { UIMessage } from 'ai'
import { isToolUIPart } from 'ai'

import { NodeDetailSheet, type NodeDetail } from './NodeDetailSheet'
import type { Erc8183Trail } from './WorkflowDocPanel'

type PlanNode = {
  node_id: string
  plan_id: string
  label: string
  skill_name: string
  depends_on: string[]
}

type DispatchState = 'pending' | 'running' | 'completed' | 'failed'

type NodeKind = 'trigger' | 'query' | 'compute' | 'decision' | 'success' | 'fail' | 'notify' | 'synthesis'

interface PixelNodeData extends Record<string, unknown> {
  label: string
  skill: string
  status: DispatchState
  kind: NodeKind
}

// ════════════════════════════════════════════════════════════════
// CUSTOM PIXEL NODE
// ════════════════════════════════════════════════════════════════
const SWEEP_COLORS: Record<NodeKind, string> = {
  trigger: '#00e5ff',
  query: '#00e5ff',
  compute: '#ffcc4d',
  decision: '#00e5ff',
  success: '#00e676',
  fail: '#ff1744',
  notify: '#f472b6',
  synthesis: '#d500f9',
}

// ════════════════════════════════════════════════════════════════
// CUSTOM PIXEL NODE
// ════════════════════════════════════════════════════════════════
const AGENT_META: Record<string, { name: string; icon: any; color: string; bg: string; border: string }> = {
  'crypto-scanner': { name: 'Birdeye Scanner', icon: Search, color: '#00e5ff', bg: 'rgba(0, 229, 255, 0.08)', border: 'rgba(0, 229, 255, 0.25)' },
  'whale-tracker': { name: 'Whale Tracker', icon: Cpu, color: '#3d5afe', bg: 'rgba(61, 90, 254, 0.08)', border: 'rgba(61, 90, 254, 0.25)' },
  'trading-signals': { name: 'Trading Signals', icon: Cpu, color: '#ffc400', bg: 'rgba(255, 196, 0, 0.08)', border: 'rgba(255, 196, 0, 0.25)' },
  'social-sentiment': { name: 'Social Sentiment', icon: Cpu, color: '#ff1744', bg: 'rgba(255, 23, 68, 0.08)', border: 'rgba(255, 23, 68, 0.25)' },
  'defi-yields': { name: 'DeFi Yields', icon: Cpu, color: '#00e676', bg: 'rgba(0, 230, 118, 0.08)', border: 'rgba(0, 230, 118, 0.25)' },
  'web-intel': { name: 'Web Intel', icon: Cpu, color: '#eceff1', bg: 'rgba(236, 239, 241, 0.08)', border: 'rgba(236, 239, 241, 0.25)' },
  'document-digest': { name: 'Document Digest', icon: FileText, color: '#00e5ff', bg: 'rgba(0, 229, 255, 0.08)', border: 'rgba(0, 229, 255, 0.25)' },
  'dca-executor': { name: 'DCA Executor', icon: Cpu, color: '#ff9100', bg: 'rgba(255, 145, 0, 0.08)', border: 'rgba(255, 145, 0, 0.25)' },
  'polymarket-pulse': { name: 'Polymarket Pulse', icon: Cpu, color: '#d500f9', bg: 'rgba(213, 0, 249, 0.08)', border: 'rgba(213, 0, 249, 0.25)' },
  'nft-floor-watch': { name: 'NFT Floor Watch', icon: Cpu, color: '#00e676', bg: 'rgba(0, 230, 118, 0.08)', border: 'rgba(0, 230, 118, 0.25)' },
  'report-composer': { name: 'Report Composer', icon: Cpu, color: '#d500f9', bg: 'rgba(213, 0, 249, 0.08)', border: 'rgba(213, 0, 249, 0.25)' },
  'email-sender': { name: 'Email Sender', icon: Send, color: '#00b0ff', bg: 'rgba(0, 176, 255, 0.08)', border: 'rgba(0, 176, 255, 0.25)' },
  'telegram-sender': { name: 'Hermes Telegram', icon: Send, color: '#2979ff', bg: 'rgba(41, 121, 255, 0.08)', border: 'rgba(41, 121, 255, 0.25)' },
}

function getNodeBullets(skill: string, status: DispatchState): string[] {
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
    switch (skill) {
      case 'crypto-scanner':
        return ['Scanned SOL pools successfully', 'Price: $1.42 (+5.2%)', 'Market Cap: $140K / Holders: 2.1K']
      case 'whale-tracker':
        return ['Wallet transfer logs analyzed', 'Large transactions verified', 'Flow assessment complete']
      case 'trading-signals':
        return ['RSI/MACD calculations complete', 'Indicators successfully parsed', 'Technical status updated']
      case 'social-sentiment':
        return ['LunarCrush social metrics scanned', 'Sentiment Score: 85%', 'Trend: Strong Bullish']
      case 'defi-yields':
        return ['Top defi yields scanned', 'TVL requirements verified', 'APY metrics compiled']
      case 'web-intel':
        return ['Search query completed', 'Extracted relevant news articles', 'Synthesized macro data']
      case 'document-digest':
        return ['Digested external URL paper', 'LLM semantic analysis complete', 'Dynamic outline ready']
      case 'dca-executor':
        return ['DCA cost average simulated', 'Cost-basis schedules calculated', 'Projections saved']
      case 'polymarket-pulse':
        return ['Polymarket odds extracted', 'Prediction sentiment compiled', 'Highest-volume pools parsed']
      case 'nft-floor-watch':
        return ['OpenSea floor stats synced', 'NFT collections floor verified', 'Floor deviation checked']
      case 'email-sender':
        return ['Resend email dispatched', 'Delivery confirmed by API', 'Markdown alert delivered']
      case 'telegram-sender':
        return ['Message sent to GigaWork_Signals', 'Delivery confirmed to chat_id', 'Real-time telemetry dispatched']
      case 'report-composer':
        return ['Final report composed', 'Preceding outputs integrated', 'Synthesis report published']
      default:
        return ['Agent finished successfully.', 'Outputs recorded in database.']
    }
  }
  return []
}

function PixelNode({ data }: NodeProps) {
  const d = data as PixelNodeData
  const { kind, status, label, skill } = d
  const decoration = NODE_DECOR[kind]
  const Icon = decoration.icon

  // Find identity meta
  const meta = AGENT_META[skill] ?? {
    name: String(label || skill),
    icon: Icon,
    color: SWEEP_COLORS[kind] ?? '#d500f9',
    bg: 'rgba(213,0,249,0.05)',
    border: 'rgba(213,0,249,0.15)',
  }

  const statusColorCls = 
    status === 'completed'
      ? 'text-[#39ff14] gw-log-glow-emerald font-bold'
      : status === 'running'
        ? 'text-cyan-400 font-bold animate-pulse'
        : status === 'failed'
          ? 'text-red-400 font-bold'
          : 'text-white/40 font-mono'

  const borderCls = 
    status === 'completed'
      ? 'border-emerald-500/35 gw-node-glow-emerald'
      : status === 'running'
        ? 'border-cyan-400 gw-node-glow-cyan animate-pulse'
        : status === 'failed'
          ? 'border-red-500/35 gw-node-glow-red'
          : 'border-white/5 bg-[rgba(10,8,20,0.65)] hover:border-white/10'

  const bullets = getNodeBullets(skill, status)

  return (
    <div className="flex cursor-grab flex-col items-center active:cursor-grabbing font-mono text-xs select-none">
      <Handle 
        type="target" 
        position={Position.Left} 
        style={{ 
          background: status === 'completed' ? '#39ff14' : status === 'running' ? '#00e5ff' : 'rgba(255,255,255,0.2)',
          border: '1px solid rgba(0,0,0,0.5)',
          width: 8,
          height: 8,
          boxShadow: status === 'running' || status === 'completed' ? '0 0 6px currentColor' : undefined
        }} 
      />
      
      {/* Sleek Glassmorphic Rounded Card Box */}
      <div 
        className={`w-64 border p-4 bg-[#0a0718]/90 rounded-2xl ${borderCls} transition-all duration-300 relative group`}
        style={{
          boxShadow: status === 'running' ? `0 0 20px ${meta.border}` : undefined,
        }}
      >
        {/* Header Block */}
        <div className="flex items-center gap-3">
          {/* Avatar Icon Frame */}
          <div 
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all duration-300 group-hover:scale-105"
            style={{
              backgroundColor: meta.bg,
              borderColor: meta.border,
              color: meta.color,
              boxShadow: status === 'running' ? `0 0 10px ${meta.color}60` : undefined,
            }}
          >
            {(() => {
              const IconComp = meta.icon
              return <IconComp className="h-5 w-5" />
            })()}
          </div>
          
          {/* Details */}
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-[11px] font-bold uppercase tracking-wider text-white group-hover:text-cyan-300 transition-colors">
              {meta.name}
            </h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-[9px] uppercase tracking-widest leading-none ${statusColorCls}`}>
                [{status === 'completed' ? 'Completed' : status === 'running' ? 'Running' : status === 'failed' ? 'Failed' : 'Pending'}]
              </span>
            </div>
          </div>
        </div>

        {/* Live Telemetry Bullets list */}
        {bullets.length > 0 && (
          <div className="mt-3 space-y-1.5 pl-0.5 border-t border-white/5 pt-2.5 text-[9px] text-white/55">
            {bullets.map((bullet, idx) => (
              <div key={idx} className="flex items-center gap-2 pl-0.5">
                <span 
                  className="w-1.5 h-1.5 rounded-full shrink-0" 
                  style={{ 
                    backgroundColor: status === 'completed' ? '#39ff14' : status === 'running' ? meta.color : 'rgba(255,255,255,0.2)',
                    boxShadow: status === 'completed' ? '0 0 4px #39ff14' : undefined 
                  }}
                />
                <span className="truncate">{bullet}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        style={{ 
          background: status === 'completed' ? '#39ff14' : status === 'running' ? '#00e5ff' : 'rgba(255,255,255,0.2)',
          border: '1px solid rgba(0,0,0,0.5)',
          width: 8,
          height: 8,
          boxShadow: status === 'running' || status === 'completed' ? '0 0 6px currentColor' : undefined
        }} 
      />
    </div>
  )
}

const nodeTypes = { pixel: PixelNode }

const NODE_DECOR: Record<NodeKind, { cls: string; icon: LucideIcon }> = {
  trigger:   { cls: 'giga-node-blue',     icon: Play },
  query:     { cls: 'giga-node-blue',     icon: Search },
  compute:   { cls: 'giga-node-yellow',   icon: Cpu },
  decision:  { cls: 'giga-node-decision', icon: GitBranch },
  success:   { cls: 'giga-node-green',    icon: CheckCircle2 },
  fail:      { cls: 'giga-node-red',      icon: XCircle },
  notify:    { cls: 'giga-node-pink',     icon: Send },
  synthesis: { cls: 'giga-node-violet',   icon: FileText },
}

const VERIFIED_PILL: Record<NodeKind, { bg: string; border: string; text: string; label: string }> = {
  trigger:   { bg: '#2d3a54', border: '#4c648a', text: '#5eead4', label: 'Verified' },
  query:     { bg: '#2d3a54', border: '#4c648a', text: '#5eead4', label: 'Verified' },
  compute:   { bg: '#5c4d21', border: '#a68c3c', text: '#fde68a', label: 'Verified' },
  decision:  { bg: '#2d3a54', border: '#3e4f6e', text: '#5eead4', label: 'Verified' },
  success:   { bg: '#1f3632', border: '#3e6a62', text: '#6ee7b7', label: 'Verified' },
  fail:      { bg: '#4a272b', border: '#7a4248', text: '#fca5a5', label: 'Verified' },
  notify:    { bg: '#3a1f33', border: '#8e3a6a', text: '#f9a8d4', label: 'Sent' },
  synthesis: { bg: '#2a1d3e', border: '#5e3a8e', text: '#c4b5fd', label: 'Composed' },
}

// ════════════════════════════════════════════════════════════════
// PLACEHOLDER (while brain plans)
// ════════════════════════════════════════════════════════════════
const PLACEHOLDERS: Node[] = [0, 1, 2, 3].map((i) => ({
  id: `p${i}`,
  position: { x: 60 + i * 220, y: 200 },
  draggable: false,
  data: { label: '' },
  style: {
    width: 110,
    height: 80,
    background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: i === 2 ? 12 : 14,
    transform: i === 2 ? 'rotate(45deg)' : undefined,
  },
}))

const PLACEHOLDER_EDGES: Edge[] = [
  { id: 'pe1', source: 'p0', target: 'p1', style: { stroke: 'rgba(255,255,255,0.1)', strokeDasharray: '4 4' } },
  { id: 'pe2', source: 'p1', target: 'p2', style: { stroke: 'rgba(255,255,255,0.1)', strokeDasharray: '4 4' } },
  { id: 'pe3', source: 'p2', target: 'p3', style: { stroke: 'rgba(255,255,255,0.1)', strokeDasharray: '4 4' } },
]

// ════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════
export function WorkflowCanvas({
  messages,
  status,
  workflowId,
  erc8183,
  onNodeUpdated,
}: {
  messages: UIMessage[]
  status?: string
  workflowId?: string
  erc8183?: Erc8183Trail | null
  onNodeUpdated?: () => void
}) {
  // Re-derive plan from messages — pure function, runs every render but cheap.
  const { nodes: planNodes, edges: planEdges, hasPlan, details } = useMemo(
    () => buildFromMessages(messages),
    [messages],
  )

  const planById = useMemo(() => planIndex(messages), [messages])
  const [selectedNode, setSelectedNode] = useState<NodeDetail | null>(null)

  // React Flow's own node/edge state — once rendered, position lives here.
  // We sync from `planNodes` only when the plan adds/removes nodes or when
  // a node's status changes. We NEVER overwrite a position that the user
  // has dragged. This is what makes the canvas "sticky" even while the
  // brain stream keeps producing new messages.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([])
  const draggedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]))
      return planNodes.map((n) => {
        const old = prevById.get(n.id)
        if (old && draggedRef.current.has(n.id)) {
          // User-dragged node: keep position, only refresh data (status)
          return { ...n, position: old.position }
        }
        return n
      })
    })
    setRfEdges(planEdges)
  }, [planNodes, planEdges, setRfNodes, setRfEdges])

  const handleNodesChange = (changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.dragging === false) {
        // User finished dragging this node — mark it as "user-positioned"
        // so the next plan-rebuild won't reset it.
        draggedRef.current.add(c.id)
      }
    }
    onNodesChange(changes)
  }

  const resetLayout = () => {
    draggedRef.current.clear()
    setRfNodes(planNodes)
  }

  const handleNodeClick = (_e: React.MouseEvent, node: Node) => {
    const meta = planById.get(node.id)
    const det = details.get(node.id)
    if (!meta) return
    setSelectedNode({
      id: node.id,
      label: meta.label,
      skill: meta.skill,
      status: det?.status ?? 'pending',
      input: det?.input,
      output: det?.output,
      startedAt: det?.startedAt ?? null,
      finishedAt: det?.finishedAt ?? null,
    })
  }

  const showPlaceholder = !hasPlan
  const showFailedEmpty = showPlaceholder && status === 'failed'
  const showCompletedEmpty = showPlaceholder && status === 'completed'
  const showIdleEmpty = showPlaceholder && !showFailedEmpty && !showCompletedEmpty &&
    status !== 'streaming' && status !== 'submitted' && status !== 'running'
  const flowNodes = showPlaceholder ? PLACEHOLDERS : rfNodes
  const flowEdges = showPlaceholder ? PLACEHOLDER_EDGES : rfEdges
  const trail = useMemo(
    () => buildCanvasTrail(messages, planNodes, details, erc8183, status),
    [messages, planNodes, details, erc8183, status],
  )

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={showPlaceholder ? undefined : handleNodesChange}
        onEdgesChange={showPlaceholder ? undefined : onEdgesChange}
        onNodeClick={showPlaceholder ? undefined : handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.35, maxZoom: 1 }}
        panOnDrag
        zoomOnScroll
        nodesDraggable={!showPlaceholder}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="rgba(255,255,255,0.05)" />
        {!showPlaceholder && (
          <Controls
            showInteractive={false}
            className="!border-2 !border-black !bg-[var(--giga-panel)]"
          >
            <ControlButton onClick={resetLayout} title="Reset layout (về vị trí auto)">
              <Maximize2 className="h-3 w-3" />
            </ControlButton>
          </Controls>
        )}
      </ReactFlow>
      {showPlaceholder && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
          {!showFailedEmpty && !showCompletedEmpty && !showIdleEmpty && (
            <div className="flex -space-x-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="gw-pulse-soft h-7 w-7 rounded-full border-2 border-[#0f131c] bg-gradient-to-br from-[var(--giga-accent)]/40 to-purple-400/20"
                  style={{ animationDelay: `${i * 200}ms` }}
                />
              ))}
            </div>
          )}
          <div
            className={`border-2 px-4 py-2 text-sm font-medium ${
              showFailedEmpty
                ? 'border-red-400/50 bg-red-500/10 text-red-200'
                : showCompletedEmpty || showIdleEmpty
                  ? 'border-white/20 bg-white/[0.04] text-white/65'
                  : 'border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 text-[var(--giga-accent)] shadow-[0_0_15px_rgba(255,204,77,0.3)]'
            }`}
          >
            {showFailedEmpty
              ? 'Workflow stopped before any agent node was created.'
              : showCompletedEmpty
                ? 'Workflow finished without a replayable canvas plan.'
                : showIdleEmpty
                  ? 'Send a prompt to start Hermes orchestration.'
                  : 'Hermes Agent is orchestrating workflow...'}
          </div>
        </div>
      )}

      {/* Floating ERC-8183 Trail Panel (Bản đồ tiến trình bảo chứng) */}
      {erc8183 && (
        <div className="pointer-events-auto absolute bottom-4 left-4 z-10 max-h-[58vh] w-80 overflow-y-auto rounded-xl border border-emerald-500/30 bg-[#0a0d14]/95 p-4 shadow-xl backdrop-blur-md">
          <div className="mb-3 flex items-center gap-2 border-b border-emerald-500/20 pb-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/20 text-emerald-400">
              <Hexagon className="h-3.5 w-3.5" />
            </div>
            <h3 className="font-pixel-body text-xs uppercase tracking-wider text-emerald-100">Bảo Chứng ERC-8183</h3>
            <span className="ml-auto font-mono text-[9px] uppercase text-white/35">Job {erc8183.jobId ? `#${erc8183.jobId}` : 'Khởi tạo'}</span>
          </div>

          <div className="space-y-3.5 text-xs">
            {/* Shipping-tracker Style Progress (Thanh tiến trình trực quan tối giản) */}
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5 space-y-2">
              <div className="flex items-center justify-between text-[10px] text-white/40 uppercase font-mono tracking-wider">
                <span>Tiến trình xử lý</span>
                {erc8183.budgetUsdc && (
                  <span className="text-cyan-300 font-bold font-sans">{erc8183.budgetUsdc} USDC Locked</span>
                )}
              </div>

              <div className="space-y-2 text-[11px]">
                {/* Step 1: Secure Escrow */}
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${trail.settleState === 'active' || trail.settleState === 'done' || !!erc8183.fundTx ? 'text-emerald-400' : 'text-white/30'}`}>
                    {trail.settleState === 'done' || !!erc8183.fundTx ? '🟢' : '🔄'}
                  </span>
                  <span className={(trail.settleState === 'active' || trail.settleState === 'done' || !!erc8183.fundTx) ? 'text-emerald-300 font-medium' : 'text-white/40'}>
                    Nạp bảo chứng an toàn
                  </span>
                </div>

                {/* Step 2: AI Dispatch */}
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${trail.agentState === 'done' ? 'text-emerald-400' : trail.agentState === 'active' ? 'text-cyan-400 animate-pulse' : 'text-white/30'}`}>
                    {trail.agentState === 'done' ? '🟢' : trail.agentState === 'active' ? '🔄' : '⏳'}
                  </span>
                  <span className={trail.agentState === 'done' ? 'text-emerald-300/80' : trail.agentState === 'active' ? 'text-cyan-300 font-medium animate-pulse' : 'text-white/40'}>
                    AI Expert đang làm việc
                  </span>
                </div>

                {/* Step 3: Report & Delivery */}
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${trail.reportReady ? 'text-emerald-400' : trail.reportState === 'active' ? 'text-cyan-400' : 'text-white/30'}`}>
                    {trail.reportReady ? '🟢' : '⏳'}
                  </span>
                  <span className={trail.reportReady ? 'text-emerald-300/80' : 'text-white/40'}>
                    Bàn giao báo cáo nghiệm thu
                  </span>
                </div>

                {/* Step 4: Release Payment & Reputation */}
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${trail.reputationState === 'done' ? 'text-emerald-400' : 'text-white/30'}`}>
                    {trail.reputationState === 'done' ? '🟢' : '⏳'}
                  </span>
                  <span className={trail.reputationState === 'done' ? 'text-emerald-300/80 font-bold' : 'text-white/40'}>
                    Giải ngân & Ghi nhận uy tín (+95)
                  </span>
                </div>
              </div>
            </div>

            {/* Collapsible Developer Logs Accordion (Bảng chi tiết giao dịch blockchain ẩn đi) */}
            <details className="group mt-2 border-t border-white/10 pt-2.5 text-[10px] font-mono">
              <summary className="list-none flex items-center justify-between cursor-pointer text-white/35 hover:text-emerald-400 transition-colors select-none">
                <span>[+] Log giao dịch On-chain</span>
                <span className="group-open:rotate-180 transition-transform">▼</span>
              </summary>
              
              <div className="space-y-2 mt-2 bg-black/40 p-2.5 rounded-lg border border-white/5">
                <div className="grid grid-cols-2 gap-1 mb-1">
                  <CanvasStateRow label="Lập kế hoạch" state={trail.planState} detail={`${planNodes.length || 0} bước`} />
                  <CanvasStateRow label="Agent Proof" state={trail.agentState} detail={`${trail.completed}/${trail.total || 0}`} />
                </div>

                {trail.agentRows.length > 0 && (
                  <div className="space-y-1 border-t border-white/5 pt-1.5 pb-1">
                    <p className="text-[8px] uppercase tracking-widest text-white/30">Bằng chứng Agent (8004)</p>
                    {trail.agentRows.map((row) => (
                      <CanvasProofRow key={row.id} label={row.label} tx={row.tx} state={row.state} />
                    ))}
                  </div>
                )}

                <div className="space-y-1.5 border-t border-white/5 pt-1.5">
                  <div className="flex items-center justify-between text-white/50">
                    <span>Job ID</span>
                    <span className="text-emerald-400 font-bold">{erc8183.jobId ? `#${erc8183.jobId}` : 'chờ...'}</span>
                  </div>
                  <CanvasTxRow label="Khởi tạo job" tx={erc8183.createTx} active={!erc8183.jobId && !!erc8183.createTx} />
                  <CanvasTxRow label="Thiết lập quỹ" tx={erc8183.setBudgetTx} active={!!erc8183.jobId && !erc8183.setBudgetTx} />
                  <CanvasTxRow label="Ủy quyền USDC" tx={erc8183.approveTx} active={!!erc8183.setBudgetTx && !erc8183.approveTx} />
                  <CanvasTxRow label="Nạp tiền Escrow" tx={erc8183.fundTx} active={!!erc8183.approveTx && !erc8183.fundTx} />
                  <CanvasTxRow label="Nộp sản phẩm" tx={erc8183.submitTx} active={trail.reportReady && !!erc8183.fundTx && !erc8183.submitTx} />
                  <CanvasTxRow label="Giải phóng quỹ" tx={erc8183.completeTx} active={!!erc8183.submitTx && !erc8183.completeTx} />
                  {trail.reputationTx && <CanvasTxRow label="Lưu điểm Uy tín" tx={trail.reputationTx} />}
                </div>
              </div>
            </details>
          </div>
        </div>
      )}

      <NodeDetailSheet
        detail={selectedNode}
        onClose={() => setSelectedNode(null)}
        workflowId={workflowId}
        onNodeUpdated={onNodeUpdated}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MAP MESSAGES → NODES
// ════════════════════════════════════════════════════════════════
interface DispatchDetail {
  status: DispatchState
  input?: unknown
  output?: unknown
  startedAt?: number | null
  finishedAt?: number | null
}

export function buildFromMessages(messages: UIMessage[]): {
  nodes: Node[]
  edges: Edge[]
  hasPlan: boolean
  details: Map<string, DispatchDetail>
} {
  let plan: PlanNode[] = []
  const dispatchStatus = new Map<string, DispatchState>()
  const details = new Map<string, DispatchDetail>()

  for (const m of messages) {
    for (const part of m.parts) {
      if (!isToolUIPart(part)) continue
      const toolName = part.type.replace(/^tool-/, '')
      if (toolName === 'planWorkflow' && part.state === 'output-available') {
        const out = part.output as { nodes?: PlanNode[] } | undefined
        if (out?.nodes?.length && plan.length === 0) plan = out.nodes
      }
      if (toolName === 'dispatchSkill') {
        const input = (part.input as { node_id?: string; input_json?: string; input?: unknown } | undefined) ?? {}
        const planId = findPlanIdByNodeId(plan, input.node_id)
        if (plan.length > 0 && !planId) continue
        if (!planId) continue
        const det = details.get(planId) ?? {
          status: 'pending' as DispatchState,
        }
        // Decode input_json or use raw input object if present
        if (input.input_json) {
          try { det.input = JSON.parse(input.input_json) } catch { det.input = input.input_json }
        } else if (input.input) {
          det.input = input.input
        }
        if (part.state === 'output-available') {
          const out = part.output as { ok?: boolean; output?: unknown; error?: string } | undefined
          const failed = out?.ok === false
          det.status = failed ? 'failed' : 'completed'
          det.output = failed ? out?.error : out?.output
          det.finishedAt = Date.now()
          dispatchStatus.set(planId, det.status)
        } else if (part.state === 'input-streaming' || part.state === 'input-available') {
          if (!dispatchStatus.has(planId)) {
            dispatchStatus.set(planId, 'running')
            det.status = 'running'
            det.startedAt = Date.now()
          }
        }
        details.set(planId, det)
      }
    }
  }

  if (plan.length === 0) return { nodes: [], edges: [], hasPlan: false, details }

  // Topological depth → x position
  const depth = computeDepth(plan)
  const byDepth = new Map<number, string[]>()
  for (const n of plan) {
    const d = depth.get(n.plan_id) ?? 0
    if (!byDepth.has(d)) byDepth.set(d, [])
    byDepth.get(d)!.push(n.plan_id)
  }

  // Identify roots/leaves for color classification
  const isRoot = (n: PlanNode) => n.depends_on.length === 0
  const isLeaf = (n: PlanNode) => !plan.some((p) => p.depends_on.includes(n.plan_id))

  const COL_W = 280
  const ROW_H = 230
  const positions = new Map<string, { x: number; y: number }>()
  for (const [d, ids] of byDepth) {
    ids.forEach((pid, i) => {
      const offset = (ids.length - 1) / 2
      positions.set(pid, { x: d * COL_W + 40, y: (i - offset) * ROW_H + 240 })
    })
  }

  const nodes: Node[] = plan.map((n) => {
    const status = dispatchStatus.get(n.plan_id) ?? 'pending'
    const kind = classify(n, status, isRoot(n), isLeaf(n))
    return {
      id: n.plan_id,
      type: 'pixel',
      position: positions.get(n.plan_id) ?? { x: 0, y: 0 },
      // Full label preserved — node renders multi-line via word-break
      data: {
        label: n.label,
        skill: n.skill_name,
        status,
        kind,
      },
    }
  })

  const edges: Edge[] = plan.flatMap((n) =>
    n.depends_on.map((dep) => {
      const nodeStatus = dispatchStatus.get(n.plan_id) ?? 'pending'
      const isActive = nodeStatus === 'running'
      const isCompleted = nodeStatus === 'completed'
      
      let strokeColor = '#2d2a4a'
      let filterStyle = undefined
      let width = 2
      let animated = false
      
      if (isActive) {
        strokeColor = '#00e5ff'
        filterStyle = 'drop-shadow(0 0 6px #00e5ff)'
        width = 3
        animated = true
      } else if (isCompleted) {
        strokeColor = '#39ff14'
        filterStyle = 'drop-shadow(0 0 6px rgba(57, 255, 20, 0.45))'
        width = 2.5
      }

      return {
        id: `${dep}->${n.plan_id}`,
        source: dep,
        target: n.plan_id,
        animated,
        style: {
          stroke: strokeColor,
          strokeWidth: width,
          filter: filterStyle,
          strokeDasharray: isActive ? '6 6' : undefined,
        },
      }
    }),
  )

  return { nodes, edges, hasPlan: true, details }
}

/** Build a label-and-skill lookup keyed by plan_id, used by NodeDetailSheet. */
function planIndex(messages: UIMessage[]): Map<string, { label: string; skill: string }> {
  const out = new Map<string, { label: string; skill: string }>()
  for (const m of messages) {
    for (const part of m.parts) {
      if (!isToolUIPart(part)) continue
      const toolName = part.type.replace(/^tool-/, '')
      if (toolName === 'planWorkflow' && part.state === 'output-available') {
        if (out.size > 0) continue
        const o = part.output as { nodes?: PlanNode[] } | undefined
        for (const n of o?.nodes ?? []) {
          out.set(n.plan_id, { label: n.label, skill: n.skill_name })
        }
      }
    }
  }
  return out
}

export { planIndex }

function findPlanIdByNodeId(plan: PlanNode[], nodeId?: string) {
  if (!nodeId) return null
  return plan.find((p) => p.node_id === nodeId)?.plan_id ?? null
}

function computeDepth(plan: PlanNode[]): Map<string, number> {
  const ids = new Set(plan.map((p) => p.plan_id))
  const map = new Map<string, number>()
  const visit = (id: string, seen: Set<string>): number => {
    if (map.has(id)) return map.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const node = plan.find((p) => p.plan_id === id)
    if (!node) return 0
    const deps = node.depends_on.filter((d) => ids.has(d))
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((x) => visit(x, seen)))
    map.set(id, d)
    return d
  }
  for (const p of plan) visit(p.plan_id, new Set())
  return map
}

/**
 * Classify a plan node into a visual kind based on its label, skill name,
 * and structural role. Heuristic — brain doesn't tag node kinds explicitly.
 */
function classify(
  n: PlanNode,
  status: DispatchState,
  isRoot: boolean,
  isLeaf: boolean,
): NodeKind {
  if (status === 'failed') return 'fail'

  const skill = n.skill_name.toLowerCase()
  // Skill-name short-circuits — exact match wins over label keywords
  if (skill === 'email-sender' || skill === 'telegram-sender') return 'notify'
  if (skill === 'report-composer' || skill === 'document-digest') return 'synthesis'

  const labelLower = (n.label + ' ' + skill).toLowerCase()
  if (/\b(if|decision|condition|check|when|gate)\b/.test(labelLower)) return 'decision'
  if (/\b(trigger|cron|schedule|every|interval|when\s+price)\b/.test(labelLower)) return 'trigger'
  if (/\b(notify|alert|email|telegram|push|message|inbox)\b/.test(labelLower)) return 'notify'
  if (/\b(compose|digest|report|summari|synthesi)\b/.test(labelLower)) return 'synthesis'
  if (/\b(query|fetch|scan|read|get|search|price)\b/.test(labelLower)) return 'query'
  if (/\b(compute|calculat|signal|indicator|moving\s*aver|ma[-\s]?\d|rsi|macd|ema)\b/.test(labelLower)) return 'compute'
  if (/\b(swap|trade|buy|sell|execute|action|deploy|tx)\b/.test(labelLower)) return 'success'

  if (isRoot) return 'trigger'
  if (isLeaf) return 'success'
  return 'query'
}

type CanvasTrailState = 'idle' | 'active' | 'done' | 'failed'

function buildCanvasTrail(
  messages: UIMessage[],
  planNodes: Node[],
  details: Map<string, DispatchDetail>,
  erc8183?: Erc8183Trail | null,
  workflowStatus?: string,
) {
  const statuses = [...details.values()].map((d) => d.status)
  const running = statuses.filter((s) => s === 'running').length
  const failed = statuses.filter((s) => s === 'failed').length
  const completed = statuses.filter((s) => s === 'completed').length
  const total = planNodes.length
  const agentsDone = total > 0 && completed + failed >= total
  const { hasReport, reputationTx, reputationStatus } = extractCanvasMilestones(messages, workflowStatus)
  const composerNode = planNodes.find((node) => (node.data as PixelNodeData).skill === 'report-composer')
  const composerState = composerNode ? details.get(composerNode.id)?.status ?? 'pending' : undefined
  const reportReady = hasReport || composerState === 'completed'
  const planState: CanvasTrailState = total > 0 ? 'done' : 'active'
  const agentState: CanvasTrailState = failed > 0
    ? 'failed'
    : agentsDone
      ? 'done'
      : running > 0 || total > 0
        ? 'active'
        : 'idle'
  const reportState: CanvasTrailState = reportReady
    ? 'done'
    : composerState === 'failed'
      ? 'failed'
      : composerState === 'running' || composerState === 'pending' || agentsDone || running > 0
      ? 'active'
      : 'idle'
  const settleState: CanvasTrailState = erc8183?.completeTx
    ? 'done'
    : erc8183?.submitTx || (erc8183?.fundTx && reportReady)
      ? 'active'
      : 'idle'
  const reputationState: CanvasTrailState = reputationTx
    ? 'done'
    : reputationStatus === 'skipped' || reputationStatus === 'recorded'
      ? 'done'
      : reputationStatus === 'error'
        ? 'failed'
        : erc8183?.completeTx
          ? 'active'
          : 'idle'
  const current =
    reputationState === 'done'
      ? 'complete'
      : reputationState === 'active'
        ? 'reputation'
        : settleState === 'active'
          ? 'settling'
          : reportState === 'active'
            ? 'report'
            : agentState === 'active'
              ? 'agents'
              : 'funded'

  return {
    planState,
    agentState,
    reportState,
    settleState,
    reputationState,
    hasReport,
    reportReady,
    reportDetail: composerState ?? 'compose',
    reputationTx,
    reputationStatus,
    completed,
    total,
    current,
    agentRows: planNodes.map((node) => {
      const detail = details.get(node.id)
      const state: CanvasTrailState = detail?.status === 'completed'
        ? 'done'
        : detail?.status === 'failed'
          ? 'failed'
          : detail?.status === 'running'
            ? 'active'
            : 'idle'
      return {
        id: node.id,
        label: String((node.data as PixelNodeData).label ?? node.id),
        tx: null,
        state,
      }
    }),
  }
}

function extractCanvasMilestones(messages: UIMessage[], workflowStatus?: string) {
  let hasReport = false
  let reputationTx: string | null = null
  let reputationStatus: string | null = null
  for (const m of messages) {
    for (const part of m.parts) {
      if (part.type === 'text' && m.role === 'assistant') {
        const text = 'text' in part ? part.text : ''
        if (workflowStatus === 'completed' && isCanvasReportText(text)) hasReport = true
      }
      if (!isToolUIPart(part)) continue
      const toolName = part.type.replace(/^tool-/, '')
      if (toolName === 'finalizeReport' && part.state === 'output-available') {
        const output = (part.output || {}) as { ok?: boolean; summary_markdown?: string }
        if (output.ok !== false && output.summary_markdown) hasReport = true
      }
      if (toolName === 'reputationUpdate' && part.state === 'output-available') {
        const output = (part.output || {}) as { tx?: string; status?: string }
        reputationTx = output.tx ?? reputationTx
        if (output.status) reputationStatus = output.status
      }
    }
  }
  return { hasReport, reputationTx, reputationStatus }
}

function isCanvasReportText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('▸ Planning workflow')) return false
  if (trimmed.startsWith('Brain stopped before creating workflow nodes')) return false
  if (trimmed.startsWith('Workflow stopped before any agent node')) return false
  return /^#|executive summary|workflow report|evidence|recommended/i.test(trimmed)
}

function CanvasStateRow({
  label,
  state,
  detail,
}: {
  label: string
  state: CanvasTrailState
  detail: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 border border-white/10 bg-black/20 px-2 py-1.5">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          state === 'done'
            ? 'bg-emerald-300'
            : state === 'active'
              ? 'animate-pulse bg-[var(--giga-accent)]'
              : state === 'failed'
                ? 'bg-red-300'
                : 'bg-white/25'
        }`}
      />
      <span
        className={`truncate ${
          state === 'done'
            ? 'text-white/75'
            : state === 'active'
              ? 'text-[var(--giga-accent)]'
              : state === 'failed'
                ? 'text-red-200'
                : 'text-white/40'
        }`}
      >
        {label}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[9px] text-white/35">{detail}</span>
    </div>
  )
}

function CanvasProofRow({
  label,
  tx,
  state,
}: {
  label: string
  tx: string | null
  state: CanvasTrailState
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          state === 'done'
            ? 'bg-emerald-300'
            : state === 'active'
              ? 'animate-pulse bg-[var(--giga-accent)]'
              : state === 'failed'
                ? 'bg-red-300'
                : 'bg-white/25'
        }`}
      />
      <span className="min-w-0 flex-1 truncate text-white/55">{label}</span>
      {tx ? (
        <CanvasTxLink tx={tx} tone="cyan" />
      ) : (
        <span className="shrink-0 font-mono text-[10px] text-white/25">
          {state === 'active' ? 'running' : 'pending'}
        </span>
      )}
    </div>
  )
}

function CanvasTxRow({ label, tx, active }: { label: string; tx: string | null; active?: boolean }) {
  const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
  if (tx === '0x0') {
    return (
      <div className="flex items-center justify-between">
        <span className="text-white/55">{label}</span>
        <span className="font-mono text-[10px] text-white/35">allowance ok</span>
      </div>
    )
  }
  if (!tx) {
    return (
      <div className="flex items-center justify-between">
        <span className={active ? 'text-[var(--giga-accent)]' : 'text-white/55'}>{label}</span>
        <span className={active ? 'font-mono text-[10px] text-[var(--giga-accent)]' : 'text-white/30'}>
          {active ? 'active' : '-- pending --'}
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/55">{label}</span>
      <CanvasTxLink tx={tx} explorer={EXPLORER} />
    </div>
  )
}

function CanvasTxLink({
  tx,
  tone = 'emerald',
  explorer,
}: {
  tx: string
  tone?: 'emerald' | 'cyan'
  explorer?: string
}) {
  const base = explorer ?? process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
  const color = tone === 'cyan'
    ? 'text-cyan-300 hover:text-cyan-200'
    : 'text-emerald-300 hover:text-emerald-200'
  return (
    <a
      href={`${base}/tx/${tx}`}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1 font-mono text-[10px] hover:underline ${color}`}
    >
      {tx.slice(0, 8)}...{tx.slice(-4)}
      <ExternalLink className="h-2.5 w-2.5" />
    </a>
  )
}

