'use client'

import { createContext, useContext, ReactNode } from 'react'
import { WorkflowViewState } from '@/types/workflow-view'

export type NodeDetail = {
  id: string
  label: string
  skill: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  input?: unknown
  output?: unknown
  startedAt?: number | null
  finishedAt?: number | null
}

export type Erc8183Trail = {
  jobId: string | null
  createTx: string | null
  setBudgetTx: string | null
  approveTx: string | null
  fundTx: string | null
  submitTx: string | null
  completeTx: string | null
  deliverableHash: string | null
  budgetUsdc: string | null
  reputationTx: string | null
}

export interface WorkflowDataState {
  workflowId: string
  viewState: WorkflowViewState | null
  refreshViewState: () => Promise<void>
  erc8183: Erc8183Trail | null
  workflowStatus: string | null
}

export interface WorkflowUIState {
  viewMode: 'steps' | 'theater' | 'interaction' | 'canvas'
  setViewMode: (mode: 'steps' | 'theater' | 'interaction' | 'canvas') => void
  showDocPanel: boolean
  setShowDocPanel: (show: boolean) => void
  executing: boolean
  setExecuting: (executing: boolean) => void
  selectedNode: NodeDetail | null
  setSelectedNode: (node: NodeDetail | null) => void
  isDeployOpen: boolean
  setIsDeployOpen: (open: boolean) => void
  busy: boolean
  displayStatus: string
}

const DataContext = createContext<WorkflowDataState | null>(null)
const UIContext = createContext<WorkflowUIState | null>(null)

export function useWorkflowData(): WorkflowDataState {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useWorkflowData must be used within WorkflowDataProvider')
  return ctx
}

export function useWorkflowUI(): WorkflowUIState {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useWorkflowUI must be used within WorkflowUIProvider')
  return ctx
}

export function WorkflowDataProvider({
  value,
  children,
}: {
  value: WorkflowDataState
  children: ReactNode
}) {
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function WorkflowUIProvider({
  value,
  children,
}: {
  value: WorkflowUIState
  children: ReactNode
}) {
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}
