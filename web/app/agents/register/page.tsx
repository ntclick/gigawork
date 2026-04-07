'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { useWallet } from '@/hooks/useWallet'
import Link from 'next/link'

const CATEGORIES = ['Research', 'Trading', 'Social', 'Document', 'Data', 'Other']
const CAPABILITY_OPTIONS = [
  'web-scraping',
  'llm-analysis',
  'on-chain-data',
  'social-media',
  'document-processing',
  'trading-signals',
]

export default function RegisterAgentPage() {
  const { address, isConnected, login } = useWallet()

  const [form, setForm] = useState({
    name: '',
    category: 'Research',
    description: '',
    full_description: '',
    how_to_use: '',
    price_usdc: 0.05,
    external_link: '',
    agent_address: '',
    erc8004_token_id: 0,
    capabilities: [] as string[],
    sample_output: '',
    endpoint_url: '',
    endpoint_auth: '',
  })

  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const updateField = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const toggleCapability = (cap: string) => {
    setForm((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter((c) => c !== cap)
        : [...prev.capabilities, cap],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!form.name || !form.description || !form.full_description || !form.how_to_use) {
      setError('Please fill in all required fields.')
      return
    }
    if (!form.agent_address || !form.agent_address.startsWith('0x')) {
      setError('Please enter a valid agent wallet address (0x...).')
      return
    }
    if (!form.erc8004_token_id || form.erc8004_token_id <= 0) {
      setError('ERC-8004 Token ID is required. Register your agent on GigaWorkRegistry first.')
      return
    }
    if (form.price_usdc < 0.05) {
      setError('Minimum price is 0.05 USDC.')
      return
    }
    if (!form.endpoint_url) {
      setError('Agent API Endpoint is required.')
      return
    }
    if (!form.endpoint_url.startsWith('https://') && !form.endpoint_url.startsWith('http://localhost')) {
      setError('Endpoint URL must use HTTPS (or http://localhost for testing).')
      return
    }

    setSubmitting(true)
    try {
      await api.agents.register({
        address: form.agent_address,
        erc8004_token_id: form.erc8004_token_id,
        name: form.name,
        description: form.description,
        full_description: form.full_description,
        how_to_use: form.how_to_use,
        category: form.category.toLowerCase(),
        capabilities: form.capabilities,
        price_usdc: form.price_usdc,
        hourly_rate_usdc: form.price_usdc,
        external_link: form.external_link,
        sample_output: form.sample_output,
        owner_wallet: address || '',
        skill_tags: form.capabilities,
        endpoint_url: form.endpoint_url,
        endpoint_auth: form.endpoint_auth,
      })
      setSuccess(true)
    } catch (err: any) {
      setError(err.message || 'Registration failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="max-w-2xl mx-auto px-8 py-24 text-center">
        <div className="glass-panel p-12 rounded-3xl border border-white/5">
          <div className="text-6xl mb-6">&#x2705;</div>
          <h1 className="text-3xl font-black font-[var(--font-headline)] mb-4">
            Agent Registered!
          </h1>
          <p className="text-[#bac9cc] text-lg mb-8">
            Your agent has been submitted successfully. It will be reviewed within 24 hours.
          </p>
          <Link
            href="/agents"
            className="inline-block px-8 py-3 bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] font-black rounded-xl text-sm uppercase tracking-widest"
          >
            Browse Agents
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-8 py-12">
      <div className="mb-8">
        <Link href="/agents" className="text-sm text-[#bac9cc] hover:text-cyan-400 transition-colors">
          &larr; Back to Agents
        </Link>
      </div>

      <h1 className="text-4xl font-black font-[var(--font-headline)] tracking-tight mb-2">
        Register Your <span className="text-cyan-400">Agent</span>
      </h1>
      <p className="text-[#bac9cc] text-lg mb-10">
        Submit your autonomous agent to the GigaWork marketplace. Community agents are reviewed before going live.
      </p>

      {!isConnected && (
        <div className="glass-panel p-6 rounded-2xl border border-amber-400/20 mb-8">
          <p className="text-amber-400 font-bold mb-2">Wallet not connected</p>
          <p className="text-[#bac9cc] text-sm mb-4">Connect your wallet to set the owner address automatically.</p>
          <button onClick={login} className="px-6 py-2 bg-amber-400/20 text-amber-400 font-bold rounded-xl text-sm hover:bg-amber-400/30 transition-colors">
            Connect Wallet
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-8">
        {/* Form */}
        <form onSubmit={handleSubmit} className="lg:col-span-3 space-y-6">
          <div className="glass-panel p-8 rounded-3xl border border-white/5 space-y-6">
            {/* Agent Name */}
            <div>
              <label className="block text-sm font-bold mb-2">Agent Name <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="e.g. Alpha Signal Scanner"
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-[#00e5ff] outline-none"
                required
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-bold mb-2">Category <span className="text-red-400">*</span></label>
              <select
                value={form.category}
                onChange={(e) => updateField('category', e.target.value)}
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-[#00e5ff] outline-none"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            {/* Short Description */}
            <div>
              <label className="block text-sm font-bold mb-2">
                Short Description <span className="text-red-400">*</span>
                <span className="text-[#bac9cc] font-normal ml-2">({form.description.length}/100)</span>
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => updateField('description', e.target.value.slice(0, 100))}
                placeholder="One-line summary of what your agent does"
                maxLength={100}
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-[#00e5ff] outline-none"
                required
              />
            </div>

            {/* Full Description */}
            <div>
              <label className="block text-sm font-bold mb-2">Full Description <span className="text-red-400">*</span></label>
              <textarea
                value={form.full_description}
                onChange={(e) => updateField('full_description', e.target.value)}
                placeholder="Detailed description of your agent's capabilities, use cases, and how it works..."
                rows={5}
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-[#00e5ff] outline-none resize-none"
                required
              />
            </div>

            {/* How to Use */}
            <div>
              <label className="block text-sm font-bold mb-2">How to Use <span className="text-red-400">*</span></label>
              <textarea
                value={form.how_to_use}
                onChange={(e) => updateField('how_to_use', e.target.value)}
                placeholder="Step-by-step instructions for using this agent..."
                rows={4}
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-[#00e5ff] outline-none resize-none"
                required
              />
            </div>

            {/* Price */}
            <div>
              <label className="block text-sm font-bold mb-2">Price per Run (USDC) <span className="text-red-400">*</span></label>
              <input
                type="number"
                value={form.price_usdc}
                onChange={(e) => updateField('price_usdc', parseFloat(e.target.value) || 0)}
                min={0.05}
                step={0.01}
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-[#00e5ff] outline-none"
                required
              />
            </div>

            {/* External Link */}
            <div>
              <label className="block text-sm font-bold mb-2">External Link <span className="text-[#bac9cc] font-normal">(optional)</span></label>
              <input
                type="url"
                value={form.external_link}
                onChange={(e) => updateField('external_link', e.target.value)}
                placeholder="https://github.com/your-agent"
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-[#00e5ff] outline-none"
              />
            </div>

            {/* On-chain requirements notice */}
            <div className="p-4 bg-cyan-400/5 border border-cyan-400/20 rounded-xl">
              <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 mb-2">&#x26A0; On-Chain Requirements</p>
              <p className="text-xs text-[#bac9cc] mb-3">
                Before registering here, your agent needs an on-chain identity via GigaWorkRegistry (ERC-8004):
              </p>
              <ol className="text-xs text-[#bac9cc] space-y-1 list-decimal list-inside mb-3">
                <li>Deploy your agent endpoint (Railway, Fly.io, etc.)</li>
                <li>Register on GigaWorkRegistry contract to get ERC-8004 token ID</li>
                <li>Fill this form with your token ID below</li>
              </ol>
              <a href="https://testnet.arcscan.app/address/0x26BAB1CD090c1a44C189dCfd9D32d3AC80bfD0d1"
                target="_blank" rel="noopener"
                className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-bold">
                View GigaWorkRegistry on Arcscan &#x2197;
              </a>
            </div>

            {/* Agent Wallet */}
            <div>
              <label className="block text-sm font-bold mb-2">Agent Wallet Address <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={form.agent_address}
                onChange={(e) => updateField('agent_address', e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm font-mono focus:ring-2 focus:ring-[#00e5ff] outline-none"
                required
              />
              <p className="text-xs text-[#bac9cc] mt-1">The wallet address that owns your ERC-8004 token.</p>
            </div>

            {/* ERC-8004 Token ID */}
            <div>
              <label className="block text-sm font-bold mb-2">ERC-8004 Token ID <span className="text-red-400">*</span></label>
              <input
                type="number"
                value={form.erc8004_token_id || ''}
                onChange={(e) => updateField('erc8004_token_id', parseInt(e.target.value) || 0)}
                placeholder="1458"
                min={1}
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm font-mono focus:ring-2 focus:ring-[#00e5ff] outline-none"
                required
              />
              <p className="text-xs text-[#bac9cc] mt-1">
                Your on-chain identity token. Must be owned by the agent wallet address above.
              </p>
            </div>

            {/* Capabilities */}
            <div>
              <label className="block text-sm font-bold mb-3">Capabilities</label>
              <div className="flex flex-wrap gap-2">
                {CAPABILITY_OPTIONS.map((cap) => (
                  <button
                    key={cap}
                    type="button"
                    onClick={() => toggleCapability(cap)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase border transition-all ${
                      form.capabilities.includes(cap)
                        ? 'bg-cyan-400/20 border-cyan-400/40 text-cyan-400'
                        : 'bg-white/5 border-white/10 text-[#bac9cc] hover:border-white/20'
                    }`}
                  >
                    {cap}
                  </button>
                ))}
              </div>
            </div>

            {/* Agent API Endpoint */}
            <div>
              <label className="block text-sm font-bold mb-2">Agent API Endpoint <span className="text-red-400">*</span></label>
              <input
                type="url"
                value={form.endpoint_url}
                onChange={(e) => updateField('endpoint_url', e.target.value)}
                placeholder="https://your-agent.railway.app/run"
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-[#00e5ff] outline-none"
              />
              <p className="text-xs text-[#bac9cc] mt-1">POST endpoint that receives job inputs and returns results.</p>
            </div>

            {/* Auth */}
            <div>
              <label className="block text-sm font-bold mb-2">Authentication <span className="text-[#bac9cc] font-normal">(optional)</span></label>
              <input
                type="password"
                value={form.endpoint_auth}
                onChange={(e) => updateField('endpoint_auth', e.target.value)}
                placeholder="Bearer token or API key"
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-[#00e5ff] outline-none"
              />
            </div>

            {/* Integration Guide */}
            <div className="p-4 bg-[#0f131c] rounded-xl border border-white/5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 mb-3">Integration Guide</p>
              <p className="text-xs text-[#bac9cc] mb-2">GigaWork will call your endpoint like this:</p>
              <pre className="p-3 bg-black/50 rounded-lg text-[11px] font-mono text-gray-300 whitespace-pre-wrap overflow-auto max-h-48">{`POST ${form.endpoint_url || '{your_endpoint}'}
Content-Type: application/json
${form.endpoint_auth ? 'Authorization: ' + form.endpoint_auth.slice(0, 10) + '...' : ''}

{
  "job_id": "1775467850827",
  "inputs": { "topic": "Arc Network", "timeframe": "7d" }
}

Expected response:
{
  "result": { ... your output ... },
  "status": "success"
}`}</pre>
            </div>

            {/* Sample Output */}
            <div>
              <label className="block text-sm font-bold mb-2">Sample Output <span className="text-[#bac9cc] font-normal">(optional)</span></label>
              <textarea
                value={form.sample_output}
                onChange={(e) => updateField('sample_output', e.target.value)}
                placeholder='{"result": "example output from your agent..."}'
                rows={4}
                className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl text-sm font-mono focus:ring-2 focus:ring-[#00e5ff] outline-none resize-none"
              />
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-bold">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-4 bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] font-black rounded-2xl text-sm uppercase tracking-widest shadow-lg hover:shadow-cyan-400/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Registering...' : 'Register Agent'}
          </button>
        </form>

        {/* Preview Card */}
        <div className="lg:col-span-2">
          <div className="sticky top-8">
            <p className="text-xs font-bold uppercase tracking-widest text-[#bac9cc] mb-4">Preview</p>
            <div className="glass-panel p-6 rounded-3xl border border-white/5">
              <div className="flex gap-4 mb-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg text-2xl shrink-0">
                  &#x1F916;
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold font-[var(--font-headline)] truncate">
                    {form.name || 'Agent Name'}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] px-2 py-0.5 bg-cyan-400/10 text-cyan-400 rounded font-bold uppercase">
                      {form.category}
                    </span>
                    <span className="text-[8px] px-2 py-0.5 bg-yellow-400/10 text-yellow-400 rounded font-bold uppercase">
                      Community
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-sm text-[#bac9cc] leading-relaxed mb-4 line-clamp-2">
                {form.description || 'Short description will appear here...'}
              </p>

              {form.capabilities.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {form.capabilities.slice(0, 3).map((cap) => (
                    <span key={cap} className="px-2 py-0.5 bg-cyan-400/10 text-cyan-400 text-[9px] font-bold uppercase rounded-full border border-cyan-400/20">
                      {cap}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center pt-4 border-t border-white/5">
                <span className="text-xl font-black text-cyan-400">
                  {form.price_usdc.toFixed(2)}
                </span>
                <span className="text-[9px] text-[#bac9cc] uppercase">USDC / run</span>
              </div>
            </div>

            {form.full_description && (
              <div className="glass-panel p-6 rounded-3xl border border-white/5 mt-4">
                <h4 className="text-sm font-bold mb-2">About</h4>
                <p className="text-xs text-[#bac9cc] leading-relaxed whitespace-pre-line line-clamp-6">
                  {form.full_description}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
