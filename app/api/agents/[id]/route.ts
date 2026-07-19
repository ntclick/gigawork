import { type NextRequest, NextResponse } from 'next/server'
import { SKILLS } from '@/lib/skills/handlers'
import { getEndpointConfig } from '@/lib/nanopayments/config'
import { requireX402Payment, logRequest, incrementFailedCalls, parsePaymentHeader } from '@/lib/chain/nanopayments'
import { db } from '@/lib/db/client'
import { nanopaymentEvents } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const name = id
  
  // 1. Get endpoint config
  const config = getEndpointConfig(name)
  const handler = SKILLS[name]
  
  if (!config || !handler) {
    return NextResponse.json({ error: `Unknown skill: ${name}` }, { status: 404 })
  }
  
  if (!config.enabled) {
    return NextResponse.json({ error: `Skill ${name} is currently disabled` }, { status: 403 })
  }
  
  // Get remote IP address if possible
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'
  
  // 2. Require x402 Payment
  const { buyer, error } = await requireX402Payment(req, {
    resource: `/api/agents/${name}`,
    amountUsdc: config.priceUsdc,
    description: `Access to GigaWork v2 AI Agent skill: ${config.name}`,
  })
  
  if (error) {
    incrementFailedCalls()
    // If it's a 402 challenge, we log it as CHALLENGED so dashboard live logs show it
    if (error.status === 402) {
      logRequest({
        clientIp: ip,
        buyer: 'anonymous',
        endpoint: `/api/agents/${name}`,
        status: 402,
        message: `Challenge: 402 Payment Required for ${config.name} (${config.priceUsdc} USDC)`
      })
    } else {
      logRequest({
        clientIp: ip,
        buyer: 'anonymous',
        endpoint: `/api/agents/${name}`,
        status: error.status,
        message: `Rejected: Payment verification failed for ${config.name}`
      })
    }
    return error
  }
  
  // Insert event to DB if workflowId is found
  try {
    const paymentHeader = parsePaymentHeader(req)
    const headersWorkflowId = req.headers.get('X-Workflow-ID') || req.headers.get('x-workflow-id')
    const bodyClone = await req.clone().json().catch(() => ({}))
    const workflowId = headersWorkflowId || paymentHeader?.workflowId || bodyClone?.workflowId || bodyClone?.workflow_id
    const nodeId = req.headers.get('X-Node-ID') || req.headers.get('x-node-id') || paymentHeader?.nodeId || bodyClone?.nodeId || bodyClone?.node_id

    const isValidUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
    if (workflowId && isValidUuid(workflowId)) {
      db.insert(nanopaymentEvents)
        .values({
          workflowId,
          stepId: nodeId || null,
          skillName: name,
          amountUsdc: config.priceUsdc,
          buyerAddress: buyer ?? 'anonymous',
          status: 'queued',
        })
        .execute() // non-blocking call
        .catch((err) => console.error('[nanopayments] failed to insert event:', err))
    }
  } catch (err) {
    console.error('[nanopayments] error extracting workflowId:', err)
  }

  // 3. Execution phase
  const input = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    const output = await handler(input)
    
    // Log success
    logRequest({
      clientIp: ip,
      buyer: buyer ?? 'anonymous',
      endpoint: `/api/agents/${name}`,
      status: 200,
      message: `Success: ${config.name} executed. Received ${config.priceUsdc} USDC.`
    })
    
    return NextResponse.json(output)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    
    // Log execution failure (though payment was validated/saved!)
    logRequest({
      clientIp: ip,
      buyer: buyer ?? 'anonymous',
      endpoint: `/api/agents/${name}`,
      status: 500,
      message: `Failed: ${config.name} execution error: ${msg}. Payment settled.`
    })
    
    return NextResponse.json(
      { error: msg, skill: name, fallback: true, generated_at: new Date().toISOString() },
      { status: 500 }
    )
  }
}
