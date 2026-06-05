import { z } from 'zod'

export const compiledNodeSchema = z.object({
  id: z.string().min(1),
  skill_name: z.string().min(1),
  label: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
  input: z.record(z.string(), z.unknown()).default({}),
  timeout_ms: z.number().int().positive().optional(),
  optional: z.boolean().default(false),
})

export const compiledWorkflowSchema = z.object({
  mode: z.enum(['fast', 'balanced', 'deep']).default('fast'),
  max_expected_ms: z.number().int().positive().optional(),
  nodes: z.array(compiledNodeSchema).min(1),
  final_report_node: z.string().optional(),
})

export type CompiledNode = z.infer<typeof compiledNodeSchema>
export type CompiledWorkflow = z.infer<typeof compiledWorkflowSchema>
