import { WorkflowView } from '@/components/console/WorkflowView'

/**
 * Deep-linkable run view. This path must stay `/workflow/:id` —
 * lib/deployments/runCheck.ts puts it in every scheduled-run notification
 * email and Telegram message, so links already in users' inboxes point here.
 */
export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <WorkflowView workflowId={id} />
}
