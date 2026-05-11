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
  onEditNode,
  workflowId,
  erc8183,
}: {
  messages: UIMessage[]
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
  const flowNodes = showPlaceholder ? PLACEHOLDERS : rfNodes
  const flowEdges = showPlaceholder ? PLACEHOLDER_EDGES : rfEdges
  const lifecycle = useMemo(
    () => buildLifecycle(hasPlan, details, erc8183),
    [hasPlan, details, erc8183],
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
          <div className="flex -space-x-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="gw-pulse-soft h-7 w-7 rounded-full border-2 border-[#0f131c] bg-gradient-to-br from-[var(--giga-accent)]/40 to-purple-400/20"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
          <div className="border-2 border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--giga-accent)] shadow-[0_0_15px_rgba(255,204,77,0.3)]">
            🧠 Hermes Agent is orchestrating workflow...
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute left-4 top-4 z-10 hidden max-w-[calc(100%-2rem)] gap-2 md:flex">
        {lifecycle.map((step) => (
          <div
            key={step.label}
            className={`flex items-center gap-2 border px-3 py-2 text-xs backdrop-blur-md ${
              step.state === 'done'
                ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                : step.state === 'active'
                  ? 'border-[var(--giga-accent)]/50 bg-[var(--giga-accent)]/10 text-[var(--giga-accent)]'
                  : step.state === 'failed'
                    ? 'border-red-400/40 bg-red-500/10 text-red-200'
                    : 'border-white/10 bg-[#0a0d14]/75 text-white/45'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                step.state === 'done'
                  ? 'bg-emerald-300'
                  : step.state === 'active'
                    ? 'animate-pulse bg-[var(--giga-accent)]'
                    : step.state === 'failed'
                      ? 'bg-red-300'
                      : 'bg-white/25'
              }`}
            />
            <span className="whitespace-nowrap font-medium">{step.label}</span>
          </div>
        ))}
      </div>

      {/* Floating ERC-8183 Trail Panel */}
      {erc8183 && (
        <div className="absolute bottom-4 left-4 z-10 w-72 rounded-lg border border-emerald-500/30 bg-[#0a0d14]/90 p-4 backdrop-blur-md shadow-lg pointer-events-auto">
          <div className="mb-3 flex items-center gap-2 border-b border-emerald-500/20 pb-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/20 text-emerald-400">
              <Hexagon className="h-3.5 w-3.5" />
            </div>
            <h3 className="font-pixel-body text-sm uppercase text-emerald-100">ERC-8183 Trail</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-white/55">Job ID</span>
              <span className="font-mono text-emerald-300">#{erc8183.jobId}</span>
            </div>
            {erc8183.budgetUsdc && (
              <div className="flex items-center justify-between">
                <span className="text-white/55">Budget</span>
                <span className="font-mono text-cyan-300">{erc8183.budgetUsdc} USDC</span>
              </div>
            )}
            <CanvasTxRow label="Open" tx={erc8183.createTx} />
            {erc8183.setBudgetTx && <CanvasTxRow label="Set budget" tx={erc8183.setBudgetTx} />}
            {erc8183.approveTx && <CanvasTxRow label="Approve" tx={erc8183.approveTx} />}
            <CanvasTxRow label="Fund" tx={erc8183.fundTx} />
            <CanvasTxRow label="Submit" tx={erc8183.submitTx} />
            <CanvasTxRow label="Complete" tx={erc8183.completeTx} />
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
        if (out?.nodes?.length) plan = out.nodes
      }
      if (toolName === 'dispatchSkill') {
        const input = (part.input as { node_id?: string; input_json?: string } | undefined) ?? {}
        const planId = findPlanIdByNodeId(plan, input.node_id)
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

function buildLifecycle(
  hasPlan: boolean,
  details: Map<string, DispatchDetail>,
  erc8183?: Erc8183Trail | null,
): Array<{ label: string; state: 'idle' | 'active' | 'done' | 'failed' }> {
  const statuses = [...details.values()].map((d) => d.status)
  const hasRunning = statuses.includes('running')
  const hasFailed = statuses.includes('failed')
  const allCompleted = statuses.length > 0 && statuses.every((s) => s === 'completed')
  const hasSubmit = !!erc8183?.submitTx
  const hasComplete = !!erc8183?.completeTx

  return [
    { label: 'Plan', state: hasPlan ? 'done' : 'active' },
    {
      label: 'Dispatch',
      state: hasFailed ? 'failed' : allCompleted ? 'done' : hasRunning || hasPlan ? 'active' : 'idle',
    },
    {
      label: 'Compose',
      state: allCompleted ? 'done' : hasRunning || hasPlan ? 'idle' : 'active',
    },
    {
      label: 'Settle',
      state: hasComplete ? 'done' : hasSubmit ? 'active' : allCompleted ? 'active' : 'idle',
    },
    {
      label: 'Reputation',
      state: hasComplete ? 'done' : 'idle',
    },
  ]
}

function CanvasTxRow({ label, tx }: { label: string; tx: string | null }) {
  const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? 'https://testnet.arcscan.app'
  if (!tx) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-white/55">{label}</span>
        <span className="text-white/30">— pending —</span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/55">{label}</span>
      <a
        href={`${EXPLORER}/tx/${tx}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-300 hover:text-emerald-200 hover:underline"
      >
        {tx.slice(0, 8)}…{tx.slice(-4)}
        <ExternalLink className="h-2.5 w-2.5" />
      </a>
    </div>
  )
}

