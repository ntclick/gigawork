'use client'

import { useState } from 'react'
import { Search, ShieldCheck, ShieldAlert, Trophy, Award, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface VerifyPanelProps {
  raffleId: string
  drawn: boolean
}

interface VerificationResult {
  exists: boolean
  username?: string
  index?: number
  proof?: string[]
  isValid?: boolean
  isWinner?: boolean
  winningIndex?: number
  merkleRoot?: string
  message?: string
}

export function VerifyPanel({ raffleId, drawn }: VerifyPanelProps) {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [error, setError] = useState('')

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setResult(null)

    if (!username.trim()) {
      setError('Please enter a username or wallet address.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch(`/api/raffles/${raffleId}/verify-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() }),
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Verification error.')
      }

      setResult(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during verification.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border border-white/10 bg-slate-950/75 backdrop-blur-md rounded-2xl p-5 space-y-5 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-300 hover:border-cyan-500/20">
      <div className="pb-3 border-b border-white/10">
        <h4 className="text-sm font-bold uppercase tracking-wider text-slate-100 font-pixel-body flex items-center gap-2">
          <ShieldCheck className="h-4.5 w-4.5 text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]" />
          Check Winning Tickets
        </h4>
        <p className="text-slate-400 text-[11px] leading-relaxed mt-1">
          Enter your wallet address or username to generate a cryptographic Merkle Proof and check prize eligibility.
        </p>
      </div>

      <form onSubmit={handleVerify} className="flex gap-2">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter username or wallet address..."
          className="flex-1 bg-slate-950/80 border-slate-800 text-slate-200 text-xs focus:border-cyan-500/50"
          disabled={loading}
        />
        <Button
          type="submit"
          disabled={loading || !username.trim()}
          className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold uppercase tracking-wider text-[10px] px-4 py-2 shrink-0 flex items-center gap-1"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          Search
        </Button>
      </form>

      {error && (
        <div className="p-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md">
          {error}
        </div>
      )}

      {/* Result Cards */}
      {result && (
        <div className="space-y-4 animate-fadeIn">
          {/* Case 1: Doesn't exist */}
          {!result.exists && (
            <div className="p-4 border border-rose-500/20 bg-rose-500/5 rounded-xl flex items-start gap-2.5 text-xs text-rose-300">
              <ShieldAlert className="h-4.5 w-4.5 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <span className="font-semibold block text-slate-200">Ticket not found!</span>
                {result.message}
              </div>
            </div>
          )}

          {/* Case 2: Exists */}
          {result.exists && (
            <div className="space-y-3">
              {/* Winner Status Banner */}
              {drawn ? (
                result.isWinner ? (
                  <div className="p-4 border border-amber-500/30 bg-gradient-to-r from-slate-950 to-amber-950/20 rounded-xl flex items-start gap-3 text-xs text-amber-300 shadow-[0_0_25px_rgba(245,158,11,0.12)]">
                    <Trophy className="h-6 w-6 shrink-0 text-amber-400 animate-bounce" />
                    <div>
                      <strong className="text-amber-400 text-sm block mb-0.5">Congratulations! You Won!</strong>
                      Your entry is located at index <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded text-slate-200">#{result.index}</span> in the contestant list and was selected by the Space random generator.
                    </div>
                  </div>
                ) : (
                  <div className="p-4 border border-slate-800 bg-gradient-to-r from-slate-950 to-slate-900/50 rounded-xl flex items-start gap-3 text-xs text-slate-400">
                    <Award className="h-5 w-5 shrink-0 text-slate-500" />
                    <div>
                      <strong className="text-slate-300 block mb-0.5">Ticket Validated!</strong>
                      Your entry is located at index <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded text-slate-200">#{result.index}</span>. Unfortunately, the random block did not pick your ticket this time. Better luck next time!
                    </div>
                  </div>
                )
              ) : (
                <div className="p-4 border border-cyan-500/20 bg-gradient-to-r from-slate-950 to-cyan-950/20 rounded-xl flex items-start gap-3 text-xs text-cyan-300 shadow-[0_0_25px_rgba(6,182,212,0.05)]">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-cyan-400" />
                  <div>
                    <strong className="text-cyan-200 block mb-0.5">Ticket Valid &amp; Ready for Draw!</strong>
                    Your entry has been committed to the Merkle Root at index <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded text-slate-200">#{result.index}</span>.
                  </div>
                </div>
              )}

              {/* Merkle Proof Details */}
              <div className="bg-slate-950/90 border border-white/10 rounded-xl p-4 space-y-2.5 shadow-[inset_0_0_15px_rgba(0,0,0,0.4)]">
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Cryptographic Merkle Proof:</span>
                
                <div className="space-y-1 font-mono text-[10px]">
                  <div className="flex justify-between py-0.5 text-slate-400 border-b border-white/10 pb-1 mb-1">
                    <span>Level / Sibling</span>
                    <span>Hash Value (Bytes32)</span>
                  </div>
                  {result.proof && result.proof.map((p, idx) => (
                    <div key={idx} className="flex justify-between py-0.5 text-slate-400 hover:bg-white/5 px-1.5 rounded">
                      <span className="text-slate-500 font-semibold">Proof Path [{idx}]</span>
                      <span className="text-cyan-400 truncate w-60 block text-right font-medium" title={p}>{p}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1 text-slate-400 border-t border-white/10 mt-2 pt-1.5">
                    <span className="text-slate-500 font-semibold">Resolved Merkle Root</span>
                    <span className="text-emerald-400 truncate w-60 block text-right font-bold" title={result.merkleRoot}>{result.merkleRoot}</span>
                  </div>
                </div>
                
                <div className="text-[10px] text-slate-500 flex items-center justify-end gap-1 pt-1.5 border-t border-white/10">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Cryptographic Integrity Verification: </span>
                  <strong className={result.isValid ? "text-emerald-400" : "text-rose-400"}>
                    {result.isValid ? "VALID" : "INVALID"}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
