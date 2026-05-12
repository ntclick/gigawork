import { config as loadEnv } from 'dotenv'
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { decodeFunctionData, parseAbi, type Hex } from 'viem'

loadEnv({ path: '.env' })
if (process.env.DATABASE_URL?.includes('aws-1-ap-south-1.pooler.supabase.com:6543')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL
    .replace('aws-1-ap-south-1.pooler.supabase.com:6543', 'db.yxnmthhkvmjuuapsbchw.supabase.co:5432')
    .replace('postgres.yxnmthhkvmjuuapsbchw', 'postgres')
}

async function main() {
  const { ERC8183_CONTRACT, settleJob } = await import('../lib/chain/agenticCommerce')
  const { incrementReputationBatch } = await import('../lib/chain/reputation')
  const { publicClient } = await import('../lib/chain/client')
  const { db } = await import('../lib/db/client')
  const { messages, nodes, skills, users, workflows } = await import('../lib/db/schema')

  const requestedId = process.argv[2]
  const [wf] = requestedId
    ? await db.select().from(workflows).where(eq(workflows.id, requestedId)).limit(1)
    : await db
        .select()
        .from(workflows)
        .where(
          and(
            isNotNull(workflows.erc8183JobId),
            isNotNull(workflows.erc8183FundTx),
          ),
        )
        .orderBy(desc(workflows.createdAt))
        .limit(1)

  if (!wf) throw new Error('No workflow found to repair')
  if (!wf.erc8183JobId) throw new Error(`Workflow ${wf.id} has no ERC-8183 job`)

  const [final] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.workflowId, wf.id), eq(messages.toolName, 'finalizeReport')))
    .orderBy(desc(messages.createdAt))
    .limit(1)

  const finalMarkdown = final?.content ?? `Workflow ${wf.id} completed`
  console.log(`Repairing workflow ${wf.id} / job ${wf.erc8183JobId}`)

  let repairedSettlement = false
  if (!wf.erc8183CompleteTx) {
    let res = null
    const onChain = await readJobStatus(publicClient, BigInt(wf.erc8183JobId), ERC8183_CONTRACT)
    if (onChain.status === 3) {
      res = await findExistingSettlementTxs({
        publicClient,
        jobId: BigInt(wf.erc8183JobId),
        fundTx: wf.erc8183FundTx as Hex,
        contract: ERC8183_CONTRACT,
      })
    } else {
      res = await settleJob({
        jobId: wf.erc8183JobId,
        deliverableSeed: `${wf.id}:${finalMarkdown.slice(0, 256)}`,
        reasonSeed: 'workflow-completed',
      })
    }
    if (!res) throw new Error('settlement txs not found')
    await db
      .update(workflows)
      .set({
        erc8183SubmitTx: res.submitTx,
        erc8183CompleteTx: res.completeTx,
        erc8183DeliverableHash: res.deliverableHash,
        status: 'completed',
      })
      .where(eq(workflows.id, wf.id))
    console.log(`settled submit=${res.submitTx} complete=${res.completeTx}`)
    repairedSettlement = true
  } else {
    console.log(`already settled complete=${wf.erc8183CompleteTx}`)
  }

  if (!repairedSettlement) {
    console.log('skipping reputation: settlement was already recorded')
    return
  }

  const skillRows = await db
    .select({ agentTokenId: skills.agentTokenId, skillId: skills.id })
    .from(nodes)
    .innerJoin(skills, eq(nodes.skillId, skills.id))
    .where(
      and(
        eq(nodes.workflowId, wf.id),
        eq(nodes.status, 'completed'),
        isNotNull(skills.agentTokenId),
      ),
    )

  const [u] = wf.userId
    ? await db
        .select({ identityTokenId: users.identityTokenId })
        .from(users)
        .where(eq(users.id, wf.userId))
        .limit(1)
    : []

  const tokenIds = [
    ...new Set([
      ...skillRows.map((r) => r.agentTokenId!),
      u?.identityTokenId,
    ].filter(Boolean)),
  ] as string[]

  if (tokenIds.length === 0) {
    console.log('no token ids for reputation')
    return
  }

  const repTx = await incrementReputationBatch(tokenIds)
  if (!repTx) {
    console.log('reputation skipped')
    return
  }

  for (const skillId of [...new Set(skillRows.map((row) => row.skillId))]) {
    await db
      .update(skills)
      .set({ reputationScore: sql`reputation_score + 1` })
      .where(eq(skills.id, skillId))
  }
  if (wf.userId && u?.identityTokenId) {
    await db
      .update(users)
      .set({ reputationScore: sql`reputation_score + 1` })
      .where(eq(users.id, wf.userId))
  }
  console.log(`reputation tx=${repTx}`)
}

const jobAbi = parseAbi([
  'function jobs(uint256) view returns (uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook)',
])

const settleAbi = parseAbi([
  'function submit(uint256 jobId,bytes32 deliverable,bytes optParams)',
  'function complete(uint256 jobId,bytes32 reason,bytes optParams)',
])

async function readJobStatus(
  client: typeof import('../lib/chain/client').publicClient,
  jobId: bigint,
  contract: `0x${string}`,
) {
  const job = await client.readContract({
    address: contract,
    abi: jobAbi,
    functionName: 'jobs',
    args: [jobId],
  })
  return { status: Number(job[7]) }
}

async function findExistingSettlementTxs(args: {
  publicClient: typeof import('../lib/chain/client').publicClient
  jobId: bigint
  fundTx: Hex
  contract: `0x${string}`
}) {
  const fundReceipt = await args.publicClient.getTransactionReceipt({ hash: args.fundTx })
  const latest = await args.publicClient.getBlockNumber()
  const from = fundReceipt.blockNumber
  const to = latest < from + 2_000n ? latest : from + 2_000n
  let submitTx: Hex | null = null
  let completeTx: Hex | null = null
  let deliverableHash: Hex | null = null

  for (let blockNumber = from; blockNumber <= to; blockNumber++) {
    const block = await args.publicClient.getBlock({ blockNumber, includeTransactions: true })
    for (const tx of block.transactions) {
      if (tx.to?.toLowerCase() !== args.contract.toLowerCase()) continue
      try {
        const decoded = decodeFunctionData({ abi: settleAbi, data: tx.input })
        if (decoded.args[0] !== args.jobId) continue
        if (decoded.functionName === 'submit') {
          submitTx = tx.hash
          deliverableHash = decoded.args[1]
        }
        if (decoded.functionName === 'complete') completeTx = tx.hash
      } catch {
        /* not a settlement call */
      }
    }
    if (submitTx && completeTx && deliverableHash) {
      return { submitTx, completeTx, deliverableHash }
    }
  }
  return null
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
