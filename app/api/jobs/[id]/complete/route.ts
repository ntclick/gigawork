import { type NextRequest, NextResponse } from 'next/server'
import { getJobById, updateJobStatus } from '@/lib/supabase/jobs'
import { completeEscrowJob } from '@/lib/arc/job'
import { giveFeedback, getReputationScore } from '@/lib/arc/reputation'
import { submitValidationRequest, submitValidationResponse } from '@/lib/arc/validation'
import { updateAgentReputation } from '@/lib/supabase/agents'
import { adminAccount } from '@/lib/chain/client'
import { keccak256, toHex } from 'viem'
import { getCurrentUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const rating = Number(body.rating ?? 5)
    const comment = body.comment ?? 'Job completed successfully'
    const reasonSeed = body.reasonSeed ?? `completion-reason-${id}-${Date.now()}`

    // 1. Fetch job details
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

    if (job.status !== 'Submitted' && job.status !== 'Funded') {
      return NextResponse.json(
        { error: `Job must be in "Submitted" or "Funded" status to complete; current status is "${job.status}"` },
        { status: 400 }
      )
    }

    if (!job.onchainJobId) {
      return NextResponse.json({ error: 'Job does not have an on-chain ID' }, { status: 400 })
    }

    if (!job.client || !job.client.walletId || !job.client.walletAddress) {
      return NextResponse.json({ error: 'Client agent wallet is not configured' }, { status: 500 })
    }
    const evaluatorPrivateKey = (process.env.ADMIN_PRIVATE_KEY || job.client.walletId) as `0x${string}`
    const evaluatorAddress = adminAccount?.address || job.client.walletAddress

    // 1.5. Execute ERC-8004 validation and attestation
    const requestHash = keccak256(toHex(`gw-validation:${job.id}`))
    let validationRequestTx: string | null = null
    let validationResponseTx: string | null = null

    if (job.provider && job.provider.walletId && job.provider.onchainId) {
      try {
        validationRequestTx = await submitValidationRequest(
          job.provider.walletId,
          job.provider.onchainId.toString(),
          evaluatorAddress,
          requestHash
        )

        if (validationRequestTx) {
          validationResponseTx = await submitValidationResponse(requestHash, 'job_completed')
        }
      } catch (valErr) {
        console.warn('[complete] ERC-8004 validation attestation failed on-chain:', valErr)
      }
    }

    // 2. Complete the escrow job on-chain (releases USDC to provider)
    const completeTxHash = await completeEscrowJob({
      evaluatorPrivateKey,
      evaluatorAddress,
      jobId: job.onchainJobId.toString(),
      reasonSeed,
    })

    // 3. Write feedback to the Reputation contract on-chain
    let feedbackTxHash: string | null = null
    if (job.provider && job.provider.onchainId) {
      try {
        feedbackTxHash = await giveFeedback(
          job.client.walletId,
          job.provider.onchainId.toString(),
          rating,
          comment
        )

        // 4. Read the updated on-chain reputation score and update database
        const freshScore = await getReputationScore(job.provider.onchainId.toString())
        await updateAgentReputation(job.provider.agentType === 'provider' ? job.providerAgentId! : job.provider.id, freshScore.toString())
      } catch (repErr) {
        console.warn('[complete] Failed to record reputation feedback on-chain:', repErr)
      }
    }

    // 5. Update status in database to 'Completed'
    const updatedJob = await updateJobStatus(id, 'Completed', {
      completedAt: new Date(),
    })

    return NextResponse.json({
      success: true,
      job: {
        ...updatedJob,
        onchainJobId: updatedJob.onchainJobId?.toString(),
      },
      completeTxHash,
      feedbackTxHash,
      validationRequestTx,
      validationResponseTx,
    })
  } catch (err) {
    console.error('[api/jobs/[id]/complete] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
