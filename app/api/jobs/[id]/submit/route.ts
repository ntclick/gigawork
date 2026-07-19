import { type NextRequest, NextResponse } from 'next/server'
import { getJobById, updateJobStatus } from '@/lib/supabase/jobs'
import { submitEscrowDeliverable } from '@/lib/arc/job'
import { getCurrentUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const deliverableSeed = body.deliverableSeed || `deliverable-seed-${id}-${Date.now()}`

    // 1. Fetch job details
    const job = await getJobById(id)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const user = await getCurrentUser().catch(() => null)
    if (!user || !user.wallet) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }

    if (!job.provider || !job.provider.walletId || !job.provider.walletAddress) {
      return NextResponse.json({ error: 'Provider agent wallet is not configured' }, { status: 500 })
    }

    if (job.provider.ownerAddress.toLowerCase() !== user.wallet.toLowerCase()) {
      return NextResponse.json({ error: 'forbidden: you do not own the provider agent for this job' }, { status: 403 })
    }

    if (job.status !== 'Funded') {
      return NextResponse.json(
        { error: `Job must be in "Funded" status to submit; current status is "${job.status}"` },
        { status: 400 }
      )
    }

    if (!job.onchainJobId) {
      return NextResponse.json({ error: 'Job does not have an on-chain ID' }, { status: 400 })
    }

    if (!job.provider || !job.provider.walletId || !job.provider.walletAddress) {
      return NextResponse.json({ error: 'Provider agent wallet is not configured' }, { status: 500 })
    }

    // 2. Submit deliverable on-chain via Provider Agent's wallet
    const txHash = await submitEscrowDeliverable({
      providerPrivateKey: job.provider.walletId,
      providerAddress: job.provider.walletAddress,
      jobId: job.onchainJobId.toString(),
      deliverableSeed,
    })

    // 3. Update status in database
    const updatedJob = await updateJobStatus(id, 'Submitted', {
      deliverableHash: txHash, // we can store txHash or hash of seed
    })

    return NextResponse.json({
      success: true,
      job: {
        ...updatedJob,
        onchainJobId: updatedJob.onchainJobId?.toString(),
      },
      txHash,
    })
  } catch (err) {
    console.error('[api/jobs/[id]/submit] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
