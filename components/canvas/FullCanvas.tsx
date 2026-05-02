'use client'

import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

export type FullCanvasProps = {
  nodes: Node[]
  edges: Edge[]
}

export default function FullCanvas({ nodes, edges }: FullCanvasProps) {
  return (
    <div className="h-full w-full">
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background gap={16} color="rgba(255,255,255,0.06)" />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}
