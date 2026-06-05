const started = Date.now()

console.log(JSON.stringify({
  ok: false,
  status: 'pending_executor_extraction',
  message: 'bench-fast-workflow requires executor extraction from Phase 3/4',
  total_ms: Date.now() - started,
}, null, 2))

process.exit(0)
