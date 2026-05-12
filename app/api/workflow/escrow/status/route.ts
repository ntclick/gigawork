import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { pollingClient } from '@/lib/chain/client'
import { db } from '@/lib/db/client'
import { workflows } from '@/lib/db/schema'

type TxState = 'missing' | 'pending' | 'confirmed' | 'reverted' | 'not_found'

type TxProbe = {
  hash: string | null
  state: TxState
  blockNumber: string | null
}

export async function GET(req: NextRequest) {
  const workflowId = req.nextUrl.searchParams.get('workflowId')
  if (!workflowId) {
    return NextResponse.json({ error: 'workflowId_required' }, { status: 400 })
  }

  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1)

  if (!wf) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [create, approve, setBudget, fund, submit, complete] = await Promise.all([
    probeTx(wf.erc8183CreateTx),
    probeTx(wf.erc8183ApproveTx),
    probeTx(wf.erc8183SetBudgetTx),
    probeTx(wf.erc8183FundTx),
    probeTx(wf.erc8183SubmitTx),
    probeTx(wf.erc8183CompleteTx),
  ])

  const nextAction = getNextAction({
    jobId: wf.erc8183JobId,
    create,
    setBudget,
    approve,
    fund,
    submit,
    complete,
  })

  return NextResponse.json({
    ok: true,
    workflow: {
      id: wf.id,
      status: wf.status,
      jobId: wf.erc8183JobId,
      budgetUsdc: wf.erc8183BudgetUsdc,
    },
    nextAction,
    txs: {
      create,
      setBudget,
      approve,
      fund,
      submit,
      complete,
    },
  })
}

async function probeTx(hash: string | null): Promise<TxProbe> {
  if (!hash || hash === '0x0') {
    return { hash, state: 'missing', blockNumber: null }
  }

  const txHash = hash as `0x${string}`
  const receipt = await pollingClient.getTransactionReceipt({ hash: txHash }).catch(() => null)
  if (receipt) {
    return {
      hash,
      state: receipt.status === 'success' ? 'confirmed' : 'reverted',
      blockNumber: receipt.blockNumber.toString(),
    }
  }

  const tx = await pollingClient.getTransaction({ hash: txHash }).catch(() => null)
  return {
    hash,
    state: tx ? 'pending' : 'not_found',
    blockNumber: tx?.blockNumber?.toString() ?? null,
  }
}

function getNextAction(args: {
  jobId: string | null
  create: TxProbe
  setBudget: TxProbe
  approve: TxProbe
  fund: TxProbe
  submit: TxProbe
  complete: TxProbe
}) {
  if (args.complete.state === 'confirmed') return 'completed'
  if (args.submit.state === 'confirmed') return 'waiting_complete'
  if (args.fund.state === 'confirmed') return 'ready_to_run_agents'
  if (args.fund.state === 'pending') return 'wait_fund_confirmation'
  if (args.fund.state === 'not_found' || args.fund.state === 'reverted') return 'retry_fund'
  if (args.approve.state === 'pending') return 'wait_approve_confirmation'
  if (args.approve.state === 'not_found' || args.approve.state === 'reverted') return 'retry_approve'
  if (!args.jobId || args.setBudget.state === 'missing') {
    if (args.create.state === 'confirmed') return 'continue_set_budget'
    if (args.create.state === 'pending') return 'wait_create_confirmation'
    if (args.create.state === 'not_found' || args.create.state === 'reverted') return 'retry_create'
    return 'sign_create'
  }
  if (args.setBudget.state === 'pending') return 'wait_set_budget_confirmation'
  if (args.setBudget.state === 'not_found' || args.setBudget.state === 'reverted') return 'retry_set_budget'
  if (args.approve.state === 'missing') return 'sign_approve'
  return 'sign_fund'
}
