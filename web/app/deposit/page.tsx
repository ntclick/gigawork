'use client'

import { useWallet } from '@/hooks/useWallet'

function shortAddr(addr?: string) {
  if (!addr) return ''
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

export default function DepositPage() {
  const { address, isConnected, login } = useWallet()

  if (!isConnected) {
    return (
      <div className="max-w-lg mx-auto px-8 py-24 text-center">
        <h1 className="text-3xl font-black font-[var(--font-headline)] mb-4">Deposit USDC</h1>
        <p className="text-[#bac9cc] mb-6">Sign in to see your wallet address.</p>
        <button onClick={login} className="px-6 py-3 bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] font-bold rounded-xl">
          Sign In
        </button>
      </div>
    )
  }

  const copyAddress = () => {
    if (!address) return
    const ta = document.createElement('textarea')
    ta.value = address
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    const btn = document.getElementById('copy-btn')
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy' }, 2000) }
  }

  return (
    <div className="max-w-lg mx-auto px-8 py-12">
      <h1 className="text-3xl font-black font-[var(--font-headline)] mb-2">Deposit USDC</h1>
      <p className="text-[#bac9cc] mb-8">Fund your wallet with USDC on Arc Testnet.</p>

      <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-6">
        <div className="bg-[#0f131c] p-4 rounded-2xl border border-white/10 space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-[#bac9cc] font-bold">Your Wallet Address</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono text-cyan-400 break-all select-all">{address}</code>
            <button id="copy-btn" onClick={copyAddress} className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[10px] font-bold hover:bg-white/10 shrink-0">
              Copy
            </button>
          </div>
        </div>

        <a
          href="https://faucet.circle.com"
          target="_blank"
          className="block w-full py-3 bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] font-bold rounded-xl shadow-lg hover:scale-[1.02] transition-all text-sm text-center"
        >
          Get Testnet USDC from Faucet
        </a>

        <div className="bg-cyan-400/5 border border-cyan-400/10 rounded-2xl p-4">
          <div className="text-[11px] text-[#bac9cc] leading-relaxed space-y-1">
            <p><span className="text-white font-bold">Network:</span> Arc Testnet (Chain ID: 5042002)</p>
            <p><span className="text-white font-bold">Token:</span> USDC (native gas)</p>
            <p className="mt-2">1. Copy your address above</p>
            <p>2. Go to <a href="https://faucet.circle.com" target="_blank" className="text-cyan-400 underline">faucet.circle.com</a></p>
            <p>3. Select <span className="text-white font-bold">Arc Testnet</span></p>
            <p>4. Paste your address and request USDC</p>
          </div>
        </div>
      </div>
    </div>
  )
}
