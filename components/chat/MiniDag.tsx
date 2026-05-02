'use client'

import { Background, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Workflow } from 'lucide-react'

type PlanNode = {
  node_id: string
  plan_id: string
  label: string
  skill_name: string
  depends_on: string[]
}

export function MiniDag({ nodes }: { nodes: PlanNode[] }) {
  const flowNodes: Node[] = nodes.map((n, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    return {
      id: n.plan_id,
      data: { label: <NodeBody label={n.label} skill={n.skill_name} /> },
      position: { x: col * 190, y: row * 100 },
      style: {
        background: 'linear-gradient(135deg, rgba(34,211,238,0.12), rgba(168,85,247,0.06))',
        border: '1px solid rgba(34, 211, 238, 0.45)',
        borderRadius: 10,
        color: 'rgba(255,255,255,0.9)',
        fontSize: 11,
        padding: 8,
        width: 168,
        boxShadow: '0 4px 16px -8px rgba(34,211,238,0.45)',
      },
    }
  })

  const flowEdges: Edge[] = nodes.flatMap((n) =>
    n.depends_on.map((dep) => ({
      id: `${dep}->${n.plan_id}`,
      source: dep,
      target: n.plan_id,
      animated: true,
      style: { stroke: 'rgba(34, 211, 238, 0.55)', strokeWidth: 1.5 },
    })),
  )

  return (
    <div className="gw-fade-in gw-gradient-border my-3 rounded-2xl p-px">
      <div className="rounded-2xl bg-[#0f131c]/80 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-cyan-300/80">
          <Workflow className="h-3 w-3" />
          Workflow plan · {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'}
        </div>
        <div className="h-[220px] w-full overflow-hidden rounded-xl">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            nodesDraggable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} color="rgba(255,255,255,0.04)" />
          </ReactFlow>
        </div>
      </div>
    </div>
  )
}

function NodeBody({ label, skill }: { label: string; skill: string }) {
  return (
    <div className="text-center">
      <div className="text-[11px] font-medium text-white/95">{label}</div>
      <div className="mt-0.5 font-mono text-[9px] text-cyan-200/70">{skill}</div>
    </div>
  )
}
