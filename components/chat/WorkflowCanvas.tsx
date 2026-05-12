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

import { NodeDetailSheet, type NodeDetail, type NodeEditRequest } from './NodeDetailSheet'
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
function PixelNode({ data }: NodeProps) {
  const d = data as PixelNodeData
  const { kind, status, label, skill } = d
  const decoration = NODE_DECOR[kind]
  const Icon = decoration.icon
  const verifiedPill = status === 'completed'
    ? VERIFIED_PILL[kind]
    : status === 'running'
      ? { bg: 'rgba(255, 204, 77, 0.12)', border: 'var(--giga-accent)', text: '#ffe082', label: 'Running' }
      : status === 'failed'
        ? { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#fca5a5', label: 'Failed' }
        : { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.15)', text: 'rgba(255,255,255,0.5)', label: 'Pending' }

  // Decision = diamond shape (rotate 45deg + un-rotate inner)
  if (kind === 'decision') {
    return (
      <div className="flex cursor-grab flex-col items-center font-pixel-body active:cursor-grabbing">
        <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
        <div className="giga-node-decision flex h-36 w-36 rotate-45 items-center justify-center">
          <div className="-rotate-45 flex flex-col items-center px-2 text-center text-white">
            <Icon className="mb-1 h-7 w-7" aria-hidden="true" />
            <div className="text-[12px] font-bold uppercase leading-tight" style={{ wordBreak: 'break-word' }}>
              {label}
            </div>
          </div>
        </div>
        <div
          className="giga-verified-pill mt-7"
          style={{ background: verifiedPill.bg, borderColor: verifiedPill.border, color: verifiedPill.text }}
        >
          {verifiedPill.label}
        </div>
        <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      </div>
    )
  }

  // Standard rectangular pixel node — wider so labels don't clip
  const sizeCls = kind === 'compute' ? 'w-44 min-h-[9rem]' : 'w-40 min-h-[8.5rem]'
  return (
    <div className="flex cursor-grab flex-col items-center font-pixel-body active:cursor-grabbing">
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        className={`${decoration.cls} ${sizeCls} flex flex-col items-center justify-center p-3 text-center`}
      >
        <Icon className={`mb-2 h-7 w-7 ${kind === 'compute' ? 'text-black/80' : 'text-white/85'}`} aria-hidden="true" />
        <div
          className={`text-[13px] font-bold uppercase leading-tight ${kind === 'compute' ? 'text-black' : 'text-white'}`}
          style={{ wordBreak: 'break-word', hyphens: 'auto' }}
        >
          {label}
        </div>
        {skill && (
          <div
            className={`mt-1 font-mono text-[10px] tracking-tight ${kind === 'compute' ? 'text-black/55' : 'text-white/55'}`}
            style={{ wordBreak: 'break-all' }}
          >
            {skill}
          </div>
        )}
      </div>
      <div
        className="giga-verified-pill mt-3 whitespace-nowrap"
        style={{ background: verifiedPill.bg, borderColor: verifiedPill.border, color: verifiedPill.text }}
      >
        {verifiedPill.label}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
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
  onEditNode,
  workflowId,
  erc8183,
}: {
  messages: UIMessage[]
  status?: string
  onEditNode?: (req: NodeEditRequest) => void
  workflowId?: string
  erc8183?: Erc8183Trail | null
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
      dispatchTx: det?.dispatchTx ?? null,
      startedAt: det?.startedAt ?? null,
      finishedAt: det?.finishedAt ?? null,
    })
  }

  const showPlaceholder = !hasPlan
  const showFailedEmpty = showPlaceholder && status === 'failed'
  const showCompletedEmpty = showPlaceholder && status === 'completed'
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
        nodesDraggable
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
          {!showFailedEmpty && !showCompletedEmpty && (
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
                : showCompletedEmpty
                  ? 'border-white/20 bg-white/[0.04] text-white/65'
                  : 'border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 text-[var(--giga-accent)] shadow-[0_0_15px_rgba(255,204,77,0.3)]'
            }`}
          >
            {showFailedEmpty
              ? 'Workflow stopped before any agent node was created.'
              : showCompletedEmpty
                ? 'Workflow finished without a replayable canvas plan.'
                : 'Hermes Agent is orchestrating workflow...'}
          </div>
        </div>
      )}

      {/* Floating ERC-8183 Trail Panel */}
      {erc8183 && (
        <div className="pointer-events-auto absolute bottom-4 left-4 z-10 max-h-[56vh] w-80 overflow-y-auto rounded-lg border border-emerald-500/30 bg-[#0a0d14]/90 p-4 shadow-lg backdrop-blur-md">
          <div className="mb-3 flex items-center gap-2 border-b border-emerald-500/20 pb-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/20 text-emerald-400">
              <Hexagon className="h-3.5 w-3.5" />
            </div>
            <h3 className="font-pixel-body text-sm uppercase text-emerald-100">ERC-8183 Trail</h3>
            <span className="ml-auto font-mono text-[10px] uppercase text-white/35">{trail.current}</span>
          </div>
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-1.5">
              <CanvasStateRow label="Plan" state={trail.planState} detail={`${planNodes.length || 0} steps`} />
              <CanvasStateRow label="Agents" state={trail.agentState} detail={`${trail.completed}/${trail.total || 0}`} />
              <CanvasStateRow label="Report" state={trail.reportState} detail={trail.reportReady ? 'ready' : trail.reportDetail} />
              <CanvasStateRow label="Settle" state={trail.settleState} detail={erc8183.jobId ? `#${erc8183.jobId}` : 'pending'} />
              <CanvasStateRow label="Repute" state={trail.reputationState} detail={trail.reputationTx ? 'cached' : 'pending'} />
            </div>

            {trail.agentRows.length > 0 && (
              <div className="space-y-1.5 border-t border-white/10 pt-2">
                <p className="font-mono text-[10px] uppercase tracking-widest text-white/40">Agent proofs</p>
                {trail.agentRows.map((row) => (
                  <CanvasProofRow key={row.id} label={row.label} tx={row.tx} state={row.state} />
                ))}
              </div>
            )}

            <div className="space-y-2 border-t border-white/10 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-white/55">Job ID</span>
              <span className="font-mono text-emerald-300">{erc8183.jobId ? `#${erc8183.jobId}` : 'pending'}</span>
            </div>
            {erc8183.budgetUsdc && (
              <div className="flex items-center justify-between">
                <span className="text-white/55">Budget</span>
                <span className="font-mono text-cyan-300">{erc8183.budgetUsdc} USDC</span>
              </div>
            )}
            <CanvasTxRow label="Create job" tx={erc8183.createTx} active={!erc8183.jobId && !!erc8183.createTx} />
            <CanvasTxRow label="Set budget" tx={erc8183.setBudgetTx} active={!!erc8183.jobId && !erc8183.setBudgetTx} />
            <CanvasTxRow label="Approve USDC" tx={erc8183.approveTx} active={!!erc8183.setBudgetTx && !erc8183.approveTx} />
            <CanvasTxRow label="Fund escrow" tx={erc8183.fundTx} active={!!erc8183.approveTx && !erc8183.fundTx} />
            <CanvasTxRow label="Submit deliverable" tx={erc8183.submitTx} active={trail.reportReady && !!erc8183.fundTx && !erc8183.submitTx} />
            <CanvasTxRow label="Complete job" tx={erc8183.completeTx} active={!!erc8183.submitTx && !erc8183.completeTx} />
            {trail.reputationTx && <CanvasTxRow label="Reputation cache" tx={trail.reputationTx} />}
            </div>
          </div>
        </div>
      )}

      <NodeDetailSheet
        detail={selectedNode}
        onClose={() => setSelectedNode(null)}
        onEdit={onEditNode}
        workflowId={workflowId}
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
  dispatchTx?: string | null
  startedAt?: number | null
  finishedAt?: number | null
}

function buildFromMessages(messages: UIMessage[]): {
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
        const input = (part.input as { node_id?: string; input_json?: string } | undefined) ?? {}
        const planId = findPlanIdByNodeId(plan, input.node_id)
        if (plan.length > 0 && !planId) continue
        if (!planId) continue
        const det = details.get(planId) ?? {
          status: 'pending' as DispatchState,
        }
        // Decode input_json if present
        if (input.input_json) {
          try { det.input = JSON.parse(input.input_json) } catch { det.input = input.input_json }
        }
        if (part.state === 'output-available') {
          const out = part.output as { ok?: boolean; output?: unknown; error?: string; dispatch_tx?: string | null } | undefined
          const failed = out?.ok === false
          det.status = failed ? 'failed' : 'completed'
          det.output = failed ? out?.error : out?.output
          det.dispatchTx = out?.dispatch_tx ?? null
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
    n.depends_on.map((dep) => ({
      id: `${dep}->${n.plan_id}`,
      source: dep,
      target: n.plan_id,
      animated: dispatchStatus.get(n.plan_id) === 'running',
      style: {
        stroke: '#4c648a',
        strokeWidth: 3,
        strokeDasharray: '4 4',
      },
    })),
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
  const { hasReport, reputationTx } = extractCanvasMilestones(messages, workflowStatus)
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
        tx: detail?.dispatchTx ?? null,
        state,
      }
    }),
  }
}

function extractCanvasMilestones(messages: UIMessage[], workflowStatus?: string) {
  let hasReport = false
  let reputationTx: string | null = null
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
        const output = (part.output || {}) as { tx?: string }
        reputationTx = output.tx ?? reputationTx
      }
    }
  }
  return { hasReport, reputationTx }
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

