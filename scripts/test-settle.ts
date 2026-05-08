import { settleJob } from '../lib/chain/agenticCommerce'

async function main() {
  console.log('Running settleJob for #5349...')
  try {
    const res = await settleJob({
      jobId: '5349',
      deliverableSeed: 'test-seed-xyz-123',
      reasonSeed: 'workflow-completed',
    })
    console.log('Success!', res)
  } catch (err) {
    console.error('Error settling job:', err)
  }
}

main().catch(console.error)
