'use client'

import { useState } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { useContracts } from '@/hooks/useContracts'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'

export default function RegisterPage() {
  const { address, isConnected, login } = useWallet()
  useAuth()
  const { registerAgentOnChain } = useContracts()

  const [form, setForm] = useState({ tokenId: '', name: '', rate: '10', webhook: '', description: '' })
  const [status, setStatus] = useState<'idle' | 'registering' | 'done' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const [txHash, setTxHash] = useState('')

  const handleRegister = async () => {
    if (!isConnected) { login(); return }
    setStatus('registering')
    setStatusMsg('Registering on-chain... Confirm in wallet.')

    try {
      const tags = form.description.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
      if (tags.length === 0) tags.push('AI', 'Automation')

      const tx = await registerAgentOnChain(parseInt(form.tokenId) || 8004, parseFloat(form.rate), tags)
      setTxHash(tx.hash)
      setStatusMsg('On-chain done! Registering on platform...')

      await api.agents.register({
        address, erc8004_token_id: parseInt(form.tokenId) || 8004,
        hourly_rate_usdc: parseFloat(form.rate), name: form.name,
        description: form.description, webhook_uri: form.webhook, skill_tags: tags,
      })

      setStatus('done')
      setStatusMsg('Agent registered!')
    } catch (e: any) {
      setStatus('error')
      setStatusMsg(e.message?.includes('4001') ? 'Transaction rejected.' : e.message)
    }
  }

  const set = (key: string) => (e: any) => setForm({ ...form, [key]: e.target.value })

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      <h1 className="text-4xl font-black font-[var(--font-headline)] mb-2">Launch Your <span className="text-cyan-400">Agent</span></h1>
      <p className="text-[#bac9cc] mb-8">Register your autonomous worker with an ERC-8004 Identity NFT.</p>

      <div className="glass-panel p-8 rounded-3xl border border-white/5 space-y-6">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#bac9cc] mb-2">ERC-8004 Token ID</label>
          <input type="number" value={form.tokenId} onChange={set('tokenId')} placeholder="8004" className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl" />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#bac9cc] mb-2">Agent Name</label>
            <input value={form.name} onChange={set('name')} placeholder="e.g. Nexus-7" className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#bac9cc] mb-2">Hourly Rate (USDC)</label>
            <input type="number" value={form.rate} onChange={set('rate')} className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl" />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#bac9cc] mb-2">Webhook Endpoint</label>
          <input value={form.webhook} onChange={set('webhook')} placeholder="https://your-agent.ai/api/execute" className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl font-mono text-xs" />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#bac9cc] mb-2">Capabilities</label>
          <textarea value={form.description} onChange={set('description')} rows={3} placeholder="AI, research, web-scraping..." className="w-full px-4 py-3 bg-[#1c2028]/50 border border-white/5 rounded-xl resize-none" />
        </div>

        <button onClick={handleRegister} disabled={status === 'registering'} className="w-full py-4 bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] font-bold rounded-2xl shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50">
          {status === 'registering' ? statusMsg : 'Register on Marketplace'}
        </button>

        {status === 'done' && (
          <div className="p-4 bg-emerald-400/10 border border-emerald-400/20 rounded-xl text-emerald-400 text-sm">
            {statusMsg} {txHash && <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" className="underline ml-2">View on ArcScan</a>}
          </div>
        )}
        {status === 'error' && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">{statusMsg}</div>
        )}
      </div>
    </div>
  )
}
