'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { ethers } from 'ethers'
import { api } from '@/lib/api'
import { useWallet } from '@/hooks/useWallet'
import { useSendTransaction, useWallets } from '@privy-io/react-auth'
import { JobTracker } from '@/components/JobTracker'
import Link from 'next/link'

const SERVER_WALLET = '0xafe6DD950Dc2CF561e8daBA1725e0e6840f70549'
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
const ARC_CHAIN_ID = 5042002

type Agent = {
  id: string; address: string; name: string; description: string
  pricing: { per_call_usdc: number; trial_available: boolean }
  input_schema: any
}

type CachedResult = {
  cached: boolean; output?: any; reuse_price?: number; original_price?: number
  content_hash?: string; produced_at?: string
}

type Step = 'form' | 'approving' | 'executing' | 'tracking' | 'done' | 'failed'

// ─── Result display component ───────────────────────────────────────

function AgentResult({ output, agentId, onCopy }: { output: any; agentId: string; onCopy: () => void }) {
  const [expanded, setExpanded] = useState(false)

  if (!output || typeof output !== 'object') {
    return <pre className="p-4 bg-black/50 rounded-xl text-xs font-mono text-gray-300 whitespace-pre-wrap">{String(output)}</pre>
  }

  // Pick highlight fields based on agent type
  const highlights: { key: string; label: string }[] = (() => {
    if (agentId.includes('crypto-scanner')) return [
      { key: 'token_name', label: 'Token' }, { key: 'price_usd', label: 'Price' },
      { key: 'market_cap_usd', label: 'Market Cap' }, { key: 'sentiment', label: 'Sentiment' },
      { key: 'risk_score', label: 'Risk Score' }, { key: 'summary', label: 'Summary' },
    ]
    if (agentId.includes('sentiment')) return [
      { key: 'overall_sentiment', label: 'Sentiment' }, { key: 'sentiment_score', label: 'Score' },
      { key: 'summary', label: 'Summary' }, { key: 'topic', label: 'Topic' },
    ]
    if (agentId.includes('web-intel')) return [
      { key: 'title', label: 'Title' }, { key: 'summary', label: 'Summary' },
      { key: 'key_facts', label: 'Key Facts' }, { key: 'confidence_score', label: 'Confidence' },
    ]
    if (agentId.includes('document-digest')) return [
      { key: 'title', label: 'Title' }, { key: 'summary', label: 'Summary' },
      { key: 'key_points', label: 'Key Points' }, { key: 'word_count', label: 'Words' },
    ]
    if (agentId.includes('report-composer')) return [
      { key: 'title', label: 'Title' }, { key: 'executive_summary', label: 'Executive Summary' },
      { key: 'key_findings', label: 'Key Findings' }, { key: 'conclusion', label: 'Conclusion' },
    ]
    return Object.keys(output).slice(0, 6).map(k => ({ key: k, label: k.replace(/_/g, ' ') }))
  })()

  const allEntries = Object.entries(output)
  const highlightKeys = new Set(highlights.map(h => h.key))
  const extraEntries = allEntries.filter(([k]) => !highlightKeys.has(k))

  return (
    <div className="space-y-4">
      {/* Highlight fields */}
      <div className="space-y-3">
        {highlights.map(({ key, label }) => {
          const value = output[key]
          if (value === undefined || value === null) return null
          return (
            <div key={key}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#bac9cc] mb-1">
                {label}
              </p>
              {Array.isArray(value) ? (
                <ul className="list-disc list-inside text-sm text-gray-300 space-y-0.5">
                  {value.slice(0, 5).map((item: any, i: number) => (
                    <li key={i} className="text-xs">{typeof item === 'object' ? JSON.stringify(item) : String(item)}</li>
                  ))}
                  {value.length > 5 && <li className="text-xs text-[#bac9cc]">...and {value.length - 5} more</li>}
                </ul>
              ) : typeof value === 'object' ? (
                <pre className="p-3 bg-black/50 rounded-lg text-xs font-mono text-gray-300 whitespace-pre-wrap max-h-32 overflow-auto">
                  {JSON.stringify(value, null, 2)}
                </pre>
              ) : typeof value === 'string' && value.length > 120 ? (
                <p className="text-sm text-gray-300 leading-relaxed">{value}</p>
              ) : (
                <p className="text-sm text-white font-medium">{formatValue(key, value)}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Extra fields (expandable) */}
      {extraEntries.length > 0 && (
        <>
          <button onClick={() => setExpanded(!expanded)}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-bold">
            {expanded ? 'Hide Full Result' : `View Full Result (${extraEntries.length} more fields)`}
          </button>
          {expanded && (
            <div className="space-y-3 animate-fade-in">
              {extraEntries.map(([key, value]) => (
                <div key={key}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#bac9cc] mb-1">
                    {key.replace(/_/g, ' ')}
                  </p>
                  {typeof value === 'object' ? (
                    <pre className="p-3 bg-black/50 rounded-lg text-xs font-mono text-gray-300 whitespace-pre-wrap max-h-48 overflow-auto">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-sm text-gray-300">{String(value)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Powered by sub-agents (for report-composer) */}
      {agentId.includes('report-composer') && output.data_sources_used && (
        <div className="pt-3 border-t border-white/5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#bac9cc] mb-2">Powered by</p>
          <div className="flex flex-wrap gap-2">
            {(Array.isArray(output.data_sources_used) ? output.data_sources_used : []).map((src: string, i: number) => {
              const agentName = src.includes('crypto') ? 'Crypto Scanner Agent' :
                src.includes('sentiment') ? 'Social Sentiment Agent' :
                src.includes('web') ? 'Web Intel Agent' : src
              const emoji = src.includes('crypto') ? '\u{1F4CA}' :
                src.includes('sentiment') ? '\u{1F4E3}' :
                src.includes('web') ? '\u{1F310}' : '\u{1F916}'
              return (
                <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-400/10 border border-cyan-400/20 rounded-lg text-xs text-cyan-400 font-bold">
                  <span>{emoji}</span> {agentName}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Copy button */}
      <button onClick={onCopy}
        className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-bold hover:bg-white/10 transition-all">
        Copy Result
      </button>
    </div>
  )
}

function formatValue(key: string, value: any): string {
  if (typeof value === 'number') {
    if (key.includes('price') || key.includes('cap') || key.includes('volume'))
      return '$' + value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    if (key.includes('score') || key.includes('confidence'))
      return value + '/100'
    if (key.includes('change'))
      return (value >= 0 ? '+' : '') + value.toFixed(2) + '%'
  }
  return String(value)
}

// ─── Main component ─────────────────────────────────────────────────

function PostJobContent() {
  const params = useSearchParams()
  const agentSlug = params.get('agent')
  const isTrial = params.get('trial') === 'true'

  const { address, isConnected, login } = useWallet()
  const { wallets } = useWallets()
  const { sendTransaction } = useSendTransaction()

  const [agent, setAgent] = useState<Agent | null>(null)
  const [inputs, setInputs] = useState<Record<string, any>>({})
  const [step, setStep] = useState<Step>('form')
  const [jobId, setJobId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('')
  const [result, setResult] = useState<any>(null)
  const [txHashes, setTxHashes] = useState<{ posted?: string; accepted?: string; settled?: string }>({})
  const [cached, setCached] = useState<CachedResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (agentSlug) api.agents.get(agentSlug).then(setAgent).catch(() => setError('Agent not found'))
  }, [agentSlug])

  const cost = agent?.pricing?.per_call_usdc || 0.10

  // Check cache when inputs change
  useEffect(() => {
    if (!agent || isTrial) return
    const hasInputs = Object.values(inputs).some(v => v !== '' && v !== undefined)
    if (!hasInputs) { setCached(null); return }

    const timer = setTimeout(async () => {
      try {
        const res = await api.agents.cached(agent.address, inputs)
        setCached(res)
      } catch {
        setCached(null)
      }
    }, 500) // debounce

    return () => clearTimeout(timer)
  }, [agent, inputs, isTrial])

  // Fetch result + tx hashes when job completes
  const fetchResult = useCallback(async (id: number) => {
    try {
      const [resultRes, job] = await Promise.all([
        api.jobs.result(id).catch(() => null),
        api.jobs.get(id).catch(() => null),
      ])
      if (resultRes?.output) setResult(resultRes.output)
      else if (job?.result_data) setResult(job.result_data)
      if (job) {
        setTxHashes({
          posted: job.tx_hash_posted,
          accepted: job.tx_hash_accepted,
          settled: job.tx_hash_settled,
        })
      }
    } catch {}
  }, [])

  const handleCopy = useCallback(() => {
    if (result) {
      navigator.clipboard.writeText(JSON.stringify(result, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [result])

  const encodeApprove = useCallback((spender: string, amount: bigint): string => {
    const iface = new ethers.Interface([
      'function approve(address spender, uint256 amount) returns (bool)',
    ])
    return iface.encodeFunctionData('approve', [spender, amount])
  }, [])

  // ─── Use cached result ────────────────────────────────────
  const handleReuse = useCallback(async () => {
    if (!isConnected) { login(); return }
    if (!agent || !cached?.cached) return

    setError(null)
    setStep('executing')
    setStatusText('Using cached result...')

    try {
      const res = await api.jobs.execute({
        agent_address: agent.address,
        wallet: address || '',
        reuse: true,
        inputs,
      })
      setJobId(res.job_id)
      setResult(cached.output)
      setStep('done')
    } catch (e: any) {
      setError(e.message || 'Reuse failed')
      setStep('failed')
    }
  }, [agent, address, cached, inputs, isConnected, login])

  // ─── Paid flow: approve USDC via Privy then execute ───────
  const handleExecute = useCallback(async () => {
    if (!isConnected) { login(); return }
    if (!agent) return

    setError(null)

    try {
      setStep('approving')
      setStatusText('Approve USDC spending...')

      const usdcAmount = ethers.parseUnits(cost.toString(), 6)
      const approveData = encodeApprove(SERVER_WALLET, usdcAmount)

      const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy')
      if (embeddedWallet) {
        try { await embeddedWallet.switchChain(ARC_CHAIN_ID) } catch {}
      }

      const txReceipt = await sendTransaction(
        { to: USDC_ADDRESS, data: approveData, chainId: ARC_CHAIN_ID },
        { uiOptions: { description: `Approve ${cost.toFixed(2)} USDC for agent payment` } }
      )

      const approveTxHash = txReceipt?.hash || ''

      setStep('executing')
      setStatusText('Starting agent...')

      const res = await api.jobs.execute({
        agent_address: agent.address,
        wallet: address || '',
        approve_tx: approveTxHash,
        inputs,
      })

      setJobId(res.job_id)
      setStep('tracking')

    } catch (e: any) {
      const msg = e.message || 'Unknown error'
      setError(msg.includes('4001') || msg.includes('rejected') ? 'Transaction rejected.' : msg)
      setStep('failed')
    }
  }, [agent, address, cost, inputs, isConnected, login, wallets, sendTransaction, encodeApprove])

  // ─── Trial flow ───────────────────────────────────────────
  const handleTrialSubmit = useCallback(async () => {
    if (!isConnected) { login(); return }
    if (!agent) return
    setError(null)
    setStep('tracking')
    try {
      const res = await api.agents.trial(agent.address, { wallet: address, inputs, schema_version: '1.0' })
      setJobId(res.job_id)
      if (res.output) setStep('done')
    } catch (e: any) {
      setError(e.message)
      setStep('form')
    }
  }, [agent, address, inputs, isConnected, login])

  const handleSubmit = isTrial ? handleTrialSubmit : handleExecute

  if (!agent && !error) {
    return <div className="flex justify-center py-32"><div className="w-12 h-12 border-4 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      <div className="mb-8">
        <h1 className="text-4xl font-black font-[var(--font-headline)] mb-2">
          {isTrial ? 'Try' : 'Hire'} <span className="text-cyan-400">{agent?.name || 'Agent'}</span>
        </h1>
        <p className="text-[#bac9cc]">{isTrial ? 'Free trial \u2014 one per agent' : `Cost: ${cost.toFixed(2)} USDC`}</p>
      </div>

      {/* Step: Form */}
      {step === 'form' && agent && (
        <div className="glass-panel p-8 rounded-3xl border border-white/5 space-y-6 animate-fade-in">
          {agent.input_schema?.properties && Object.entries(agent.input_schema.properties).map(([key, prop]: [string, any]) => (
            <div key={key}>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-[#bac9cc] mb-2">
                {prop.title || key}
                {agent.input_schema.required?.includes(key) && <span className="text-red-400 ml-1">*</span>}
              </label>
              {prop.enum ? (
                <select className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl" onChange={(e) => setInputs({ ...inputs, [key]: e.target.value })}>
                  <option value="">Select...</option>
                  {prop.enum.map((v: string) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input type={prop.type === 'number' ? 'number' : 'text'} placeholder={prop.placeholder || ''} className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl" onChange={(e) => setInputs({ ...inputs, [key]: e.target.value })} />
              )}
            </div>
          ))}

          {/* Cache banner */}
          {cached?.cached && !isTrial && (
            <div className="p-4 bg-cyan-400/5 border border-cyan-400/20 rounded-xl space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">&#x26A1;</span>
                <span className="text-sm font-bold text-cyan-400">Cached result available</span>
              </div>
              <p className="text-xs text-[#bac9cc]">
                Same query was run before. Get instant results at a reduced price.
              </p>
              <div className="flex gap-3">
                <button onClick={handleReuse}
                  className="flex-1 py-3 bg-gradient-to-r from-cyan-500/20 to-cyan-400/20 border border-cyan-400/30 text-cyan-400 font-bold rounded-xl hover:bg-cyan-400/30 transition-all text-sm">
                  Use Cached ({(cached.reuse_price || 0).toFixed(2)} USDC)
                </button>
                <button onClick={handleSubmit}
                  className="flex-1 py-3 bg-white/5 border border-white/10 text-white font-bold rounded-xl hover:bg-white/10 transition-all text-sm">
                  Run Fresh ({cost.toFixed(2)} USDC)
                </button>
              </div>
            </div>
          )}

          {/* Main submit button (hidden when cache banner shows both options) */}
          {!(cached?.cached && !isTrial) && (
            <button onClick={handleSubmit} disabled={step !== 'form'} className="w-full py-4 bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] font-bold rounded-2xl shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">
              {!isConnected ? 'Sign In to Continue' : isTrial ? 'Start Free Trial' : `Hire Agent (${cost.toFixed(2)} USDC)`}
            </button>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl">{error}</div>
          )}
        </div>
      )}

      {/* Step: Approving USDC */}
      {step === 'approving' && (
        <div className="glass-panel p-12 rounded-3xl border border-cyan-400/20 text-center animate-fade-in">
          <div className="w-16 h-16 border-4 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-6" />
          <h2 className="text-xl font-bold font-[var(--font-headline)] text-white mb-2">Approve USDC</h2>
          <p className="text-[#bac9cc] font-medium">{statusText}</p>
          <p className="text-xs text-[#bac9cc]/50 mt-2">Approve {cost.toFixed(2)} USDC for agent payment</p>
        </div>
      )}

      {/* Step: Executing */}
      {step === 'executing' && (
        <div className="glass-panel p-12 rounded-3xl border border-white/5 text-center animate-fade-in">
          <div className="w-16 h-16 border-4 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-6" />
          <p className="text-[#bac9cc] font-medium">{statusText}</p>
        </div>
      )}

      {/* Step: Tracking */}
      {step === 'tracking' && jobId && (
        <JobTracker jobId={jobId} onComplete={() => { setStep('done'); fetchResult(jobId) }} />
      )}
      {step === 'tracking' && !jobId && (
        <div className="glass-panel p-12 rounded-3xl border border-white/5 text-center">
          <div className="w-16 h-16 border-4 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-6" />
          <p className="text-[#bac9cc]">Starting agent...</p>
        </div>
      )}

      {/* Step: Failed */}
      {step === 'failed' && (
        <div className="glass-panel p-8 rounded-3xl border border-red-500/20 space-y-4 animate-fade-in">
          <h2 className="text-xl font-bold text-red-400">Execution Failed</h2>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button onClick={() => { setStep('form'); setError(null); setResult(null) }}
            className="w-full py-3 bg-white/5 border border-white/10 font-bold rounded-xl hover:bg-white/10">
            Try Again
          </button>
        </div>
      )}

      {/* Step: Done + Result */}
      {step === 'done' && (
        <div className="space-y-6 animate-fade-in">
          <div className="glass-panel p-8 rounded-3xl border border-emerald-400/20 text-center space-y-4">
            <div className="text-5xl mb-2">&#x2705;</div>
            <h2 className="text-2xl font-bold font-[var(--font-headline)] text-emerald-400">Task Completed!</h2>
            <p className="text-sm text-[#bac9cc]">Job settled on-chain. USDC released from escrow.</p>
            {copied && <p className="text-xs text-emerald-400">Copied to clipboard!</p>}

            {/* Transaction links */}
            {(txHashes.posted || txHashes.accepted || txHashes.settled) && (
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {txHashes.posted && (
                  <a href={`https://testnet.arcscan.app/tx/${txHashes.posted}`} target="_blank" rel="noopener"
                    className="px-3 py-1.5 bg-cyan-400/10 border border-cyan-400/20 rounded-lg text-xs text-cyan-400 hover:bg-cyan-400/20">
                    Create Job &#x2197;
                  </a>
                )}
                {txHashes.accepted && (
                  <a href={`https://testnet.arcscan.app/tx/${txHashes.accepted}`} target="_blank" rel="noopener"
                    className="px-3 py-1.5 bg-cyan-400/10 border border-cyan-400/20 rounded-lg text-xs text-cyan-400 hover:bg-cyan-400/20">
                    Submit &#x2197;
                  </a>
                )}
                {txHashes.settled && (
                  <a href={`https://testnet.arcscan.app/tx/${txHashes.settled}`} target="_blank" rel="noopener"
                    className="px-3 py-1.5 bg-emerald-400/10 border border-emerald-400/20 rounded-lg text-xs text-emerald-400 hover:bg-emerald-400/20">
                    Complete &#x2197;
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Result display */}
          {result && agent && (
            <div className="glass-panel p-8 rounded-3xl border border-white/5">
              <h3 className="text-lg font-bold font-[var(--font-headline)] mb-4">Agent Result</h3>
              <AgentResult output={result} agentId={agent.id} onCopy={handleCopy} />
            </div>
          )}

          <div className="flex gap-4">
            <Link href="/dashboard" className="flex-1 py-3 bg-white/5 border border-white/10 text-center font-bold rounded-xl hover:bg-white/10">Go to Dashboard</Link>
            <button onClick={() => { setStep('form'); setResult(null); setJobId(null) }}
              className="flex-1 py-3 bg-cyan-400/10 border border-cyan-400/20 text-cyan-400 text-center font-bold rounded-xl hover:bg-cyan-400/20">
              Run Again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PostJobPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-32"><div className="w-12 h-12 border-4 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" /></div>}>
      <PostJobContent />
    </Suspense>
  )
}
