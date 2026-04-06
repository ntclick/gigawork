'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useWallet } from '@/hooks/useWallet'
import { useBalance } from '@/hooks/useBalance'
import { useState } from 'react'

const NAV_ITEMS = [
  { label: 'Marketplace', href: '/jobs' },
  { label: 'Agents', href: '/agents' },
  { label: 'Post a Task', href: '/post-job' },
  { label: 'My Jobs', href: '/dashboard' },
]

function shortAddr(addr?: string) {
  if (!addr) return ''
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

export function Navbar() {
  const pathname = usePathname()
  const { address, isConnected, login, logout, walletType } = useWallet()
  const { onChainBalance } = useBalance(address)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  return (
    <header className="fixed top-0 w-full z-50 flex justify-between items-center px-8 h-20 bg-[#0f131c]/80 backdrop-blur-xl border-b border-white/5">
      <div className="flex items-center gap-8">
        <Link href="/" className="text-2xl font-black tracking-tighter text-cyan-400 font-[var(--font-headline)] glow-text">
          GigaWork
        </Link>
        <nav className="hidden md:flex gap-6">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`text-sm font-medium transition-colors ${
                pathname?.startsWith(item.href)
                  ? 'text-white'
                  : 'text-[#bac9cc] hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {isConnected ? (
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="px-4 py-2 rounded-full text-sm font-bold bg-[#00e5ff]/10 hover:bg-[#00e5ff]/15 border border-[#00e5ff]/20 flex items-center gap-2 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
              <span className="text-xs font-mono text-[#dfe2ee] max-w-[100px] truncate">
                {shortAddr(address)}
              </span>
              <span className="text-[10px] text-[#bac9cc]">
                {onChainBalance.toFixed(2)} USDC
              </span>
              <svg className="w-3 h-3 opacity-50 shrink-0" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 8L1 3h10z" />
              </svg>
            </button>

            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-72 bg-[#1c2028] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50">
                  <div className="px-5 py-4 border-b border-white/5">
                    <p className="text-[11px] font-mono opacity-50 truncate">{shortAddr(address)}</p>
                    <p className="text-lg font-black text-cyan-400 mt-1">
                      {onChainBalance.toFixed(2)} <span className="text-xs font-normal opacity-50">USDC</span>
                    </p>
                  </div>
                  <div className="py-2">
                    <Link href="/deposit" onClick={() => setDropdownOpen(false)} className="w-full px-5 py-2.5 text-left text-sm hover:bg-white/5 flex items-center gap-3">
                      <span className="text-cyan-400">💰</span> Deposit USDC
                    </Link>
                    <button onClick={() => setDropdownOpen(false)} className="w-full px-5 py-2.5 text-left text-sm hover:bg-white/5 flex items-center gap-3 opacity-60">
                      <span className="text-amber-400">💸</span> Withdraw USDC
                    </button>
                    <button onClick={() => setDropdownOpen(false)} className="w-full px-5 py-2.5 text-left text-sm hover:bg-white/5 flex items-center gap-3 opacity-60">
                      <span className="text-purple-400">🔒</span> Stake USDC
                    </button>
                  </div>
                  <div className="border-t border-white/5 py-2">
                    <Link href="/dashboard" onClick={() => setDropdownOpen(false)} className="w-full px-5 py-2.5 text-left text-sm hover:bg-white/5 flex items-center gap-3">
                      <span>📋</span> My Jobs
                    </Link>
                  </div>
                  <div className="border-t border-white/5 py-2">
                    <button
                      onClick={() => { logout(); setDropdownOpen(false) }}
                      className="w-full px-5 py-2.5 text-left text-sm hover:bg-red-500/10 text-red-400 flex items-center gap-3"
                    >
                      <span>🚪</span> Sign Out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            onClick={login}
            className="px-6 py-2.5 rounded-full text-sm font-bold bg-gradient-to-r from-[#00e5ff] to-cyan-400 text-[#00363d] shadow-[0_0_24px_rgba(0,229,255,0.2)] hover:shadow-[0_0_32px_rgba(0,229,255,0.4)] transition-all"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  )
}
