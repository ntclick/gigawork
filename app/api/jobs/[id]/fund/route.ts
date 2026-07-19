import { type NextRequest, NextResponse } from 'next/server'
import { getJobById, updateJobStatus } from '@/lib/supabase/jobs'
import { createAndFundEscrowJob } from '@/lib/arc/job'
import { adminAccount } from '@/lib/chain/client'
import { getCurrentUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params

    // 1. Fetch job with client and provider details
    const job = await getJobById(id)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const user = await getCurrentUser().catch(() => null)
    if (!user || !user.wallet) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }

    if (!job.client || !job.client.walletId || !job.client.walletAddress) {
      return NextResponse.json({ error: 'Client agent wallet is not configured' }, { status: 500 })
    }

    if (job.client.ownerAddress.toLowerCase() !== user.wallet.toLowerCase()) {
      return NextResponse.json({ error: 'forbidden: you do not own the client agent for this job' }, { status: 403 })
    }

    if (job.status !== 'Open') {
      return NextResponse.json(
        { error: `Job must be in "Open" status to fund; current status is "${job.status}"` },
        { status: 400 }
      )
    }

    if (!job.client || !job.client.walletId || !job.client.walletAddress) {
      return NextResponse.json({ error: 'Client agent wallet is not configured' }, { status: 500 })
    }

    if (!job.provider || !job.provider.walletAddress) {
      return NextResponse.json({ error: 'Provider agent wallet address not found' }, { status: 500 })
    }

    // Designate evaluator: use adminAccount address if available, fallback to client address
    const evaluatorAddress = adminAccount?.address || job.client.walletAddress

    // 2. Execute on-chain escrow creation and funding using ClientAgent's wallet
    const result = await createAndFundEscrowJob({
      clientPrivateKey: job.client.walletId,
      clientAddress: job.client.walletAddress,
      providerAddress: job.provider.walletAddress,
      evaluatorAddress,
      budgetUsdc: job.budgetUsdc || '0.00',
      description: job.description || 'GigaWork Job Escrow',
      providerPrivateKey: job.provider.walletId || undefined,
    })

    // 3. Update database status to 'Funded'
    const updatedJob = await updateJobStatus(id, 'Funded', {
      onchainJobId: BigInt(result.jobId),
      fundedAt: new Date(),
    })

    return NextResponse.json({
      success: true,
      job: {
        ...updatedJob,
        onchainJobId: updatedJob.onchainJobId?.toString(),
      },
      escrowResult: result,
    })
  } catch (err) {
    console.error('[api/jobs/[id]/fund] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
