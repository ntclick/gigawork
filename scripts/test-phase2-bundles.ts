import { runSource, summarizeSources } from '../lib/skills/bundles/sourceRunner'
import { withTimeout } from '../lib/workflow/timing'
import { buildDeterministicReport, sanitizeReportMarkdown } from '../lib/skills/bundles/reportUtils'

async function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`)
    process.exit(1)
  }
}

async function runTests() {
  console.log('🧪 RUNNING PHASE 2 UNIT VERIFICATION TESTS...')

  // 1. Test runSource success
  console.log('\n[Test 1] Testing runSource success path...')
  const s1 = await runSource('source-1', async () => 'hello world')
  await assert(s1.ok === true, 'runSource ok should be true')
  await assert(s1.data === 'hello world', 'data should match')
  await assert(s1.durationMs >= 0, 'duration should be valid')
  console.log('🟢 Passed')

  // 2. Test runSource failure
  console.log('\n[Test 2] Testing runSource error catching...')
  const s2 = await runSource('source-2', async () => {
    throw new Error('source failure mock')
  })
  await assert(s2.ok === false, 'runSource ok should be false')
  await assert(s2.error === 'source failure mock', 'error message should match')
  await assert(s2.data === undefined, 'data should be undefined')
  console.log('🟢 Passed')

  // 3. Test runSource timeout
  console.log('\n[Test 3] Testing withTimeout behavior...')
  try {
    await withTimeout('test-timeout', 100, async (signal) => {
      if (signal.aborted) return 'aborted'
      await new Promise((resolve) => setTimeout(resolve, 300))
      return 'should not reach here'
    })
    await assert(false, 'Should have thrown timeout error')
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await assert(errorMsg.includes('timed out after 100ms'), 'Error should be a timeout message')
  }
  console.log('🟢 Passed')

  // 4. Test summarizeSources
  console.log('\n[Test 4] Testing summarizeSources aggregation...')
  const results = [
    { source: 's1', ok: true, durationMs: 10, data: 'ok-data' },
    { source: 's2', ok: false, durationMs: 15, error: 'fail-err' },
  ]
  const summary = summarizeSources(results)
  await assert(summary.partial === true, 'should be marked partial')
  await assert(summary.ok.includes('s1'), 'should have s1 in ok list')
  await assert(summary.failed[0].source === 's2', 'should have s2 in failed list')
  await assert(summary.failed[0].error === 'fail-err', 'should preserve error message')
  console.log('🟢 Passed')

  // 5. Test reportUtils fallback report
  console.log('\n[Test 5] Testing buildDeterministicReport fallback output...')
  const reportData = {
    'agent-1': { price_usd: 123.45, status: 'completed' },
    'agent-2': { error: 'mock failure' },
  }
  const report = buildDeterministicReport(reportData, 'test note')
  await assert(report.includes('test note'), 'report should contain user note')
  await assert(report.includes('agent-1'), 'report should contain agent-1 details')
  await assert(report.includes('failed (mock failure)'), 'report should contain failure status')
  
  const sanitized = sanitizeReportMarkdown('Hello 🐳 World!')
  await assert(!sanitized.includes('🐳'), 'sanitizeReportMarkdown should remove emojis')
  console.log('🟢 Passed')

  console.log('\n🎉 ALL PHASE 2 UNIT TESTS PASSED SUCCESSFULLY!')
  process.exit(0)
}

runTests().catch((err) => {
  console.error('❌ Test runner crash:', err)
  process.exit(1)
})
