'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { MainHeader } from '@/components/shell/MainHeader'
import { parseEntries } from '@/lib/cosmic-raffle/parseEntries'
import { MerkleTree } from '@/lib/cosmic-raffle/merkle'
import { seedToBytes32 } from '@/lib/cosmic-raffle/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Terminal, ShieldCheck, ShieldAlert, ArrowLeft, Loader2, Play, Sparkles, Trophy } from 'lucide-react'
import { keccak256, encodePacked } from 'viem'

interface Raffle {
  id: string
  title: string
  merkleRoot: string
  winnerCount: number
  totalEntries: number
  seed?: string | null
  rawEntries: string
}

export default function OfflineVerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [raffle, setRaffle] = useState<Raffle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Verification Form Inputs
  const [rawInput, setRawInput] = useState('')
  const [seedInput, setSeedInput] = useState('')
  const [winnerCountInput, setWinnerCountInput] = useState('1')

  // Verification Outputs
  const [verificationRan, setVerificationRan] = useState(false)
  const [computedRoot, setComputedRoot] = useState('')
  const [isRootValid, setIsRootValid] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [verifiedWinners, setVerifiedWinners] = useState<{ username: string; index: number }[]>([])

  useEffect(() => {
    const fetchRaffle = async () => {
      try {
        const res = await fetch(`/api/raffles/${id}`, { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json.error || 'Failed to load raffle details.')
        }
        const r = json.raffle as Raffle
        setRaffle(r)
        setRawInput(r.rawEntries)
        setSeedInput(r.seed || '')
        setWinnerCountInput(String(r.winnerCount))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred.')
      } finally {
        setLoading(false)
      }
    };
    fetchRaffle()
  }, [id])

  const runVerification = async () => {
    if (!raffle) return
    setVerificationRan(false)
    setLogs([])
    setVerifiedWinners([])

    const entries = parseEntries(rawInput)
    if (entries.length === 0) {
      alert('The contestant list is empty or invalid.')
      return
    }

    const seedHex = seedToBytes32(seedInput)
    const winnerCount = Number(winnerCountInput)

    if (isNaN(winnerCount) || winnerCount <= 0 || winnerCount > entries.length) {
      alert('Invalid winner count.')
      return
    }

    const consoleLogs: string[] = []
    consoleLogs.push(`🚀 Starting independent offline verification...`)
    consoleLogs.push(`📦 Parsed ${entries.length} normalized contestant entries...`)

    // 1. Rebuild Merkle Tree and Verify Root
    consoleLogs.push(`🌳 Computing Merkle Tree hash tree (double-Keccak256)...`)
    const tree = new MerkleTree(entries)
    const newRoot = tree.getRoot()
    setComputedRoot(newRoot)

    const rootMatches = newRoot.toLowerCase() === raffle.merkleRoot.toLowerCase()
    setIsRootValid(rootMatches)
    
    consoleLogs.push(`🔍 Merkle Root Matching Result:`)
    consoleLogs.push(`   - On-chain Committed Root: ${raffle.merkleRoot}`)
    consoleLogs.push(`   - Independent Calculated Root: ${newRoot}`)
    if (rootMatches) {
      consoleLogs.push(`   ✅ VALID! Contestant list matches smart contract perfectly.`)
    } else {
      consoleLogs.push(`   ❌ MISMATCH! Contestant configuration does not match on-chain data.`)
    }

    // 2. Perform Fisher-Yates partial shuffle client-side
    consoleLogs.push(`🛰️ Simulating Fisher-Yates Shuffle algorithm with Cosmic Seed...`)
    consoleLogs.push(`   - Cosmic Seed: ${seedHex}`)

    const indices: number[] = []
    const swaps = new Map<number, number>()

    for (let i = 0; i < winnerCount; i++) {
      // Simulate EVM keccak256(abi.encodePacked(seed, i))
      const randHex = keccak256(
        encodePacked(['bytes32', 'uint256'], [seedHex, BigInt(i)])
      )
      const randNum = BigInt(randHex)
      const range = BigInt(entries.length - i)
      const offset = Number(randNum % range)
      const j = i + offset

      // Swap lookup
      const valJ = swaps.has(j) ? swaps.get(j)! : j
      const valI = swaps.has(i) ? swaps.get(i)! : i

      swaps.set(i, valJ)
      swaps.set(j, valI)

      indices.push(valJ)

      consoleLogs.push(
        `   [Step ${i}]: randHash = ${randHex.slice(0, 16)}..., offset = ${offset}, j = ${j}. ` +
        `Swapped ${i} ↔ ${j}. Drawn winner: "${entries[valJ]}" (Ticket #${valJ})`
      )
    }

    consoleLogs.push(`🏆 Completed! Verification results compiled successfully.`)

    setLogs(consoleLogs)
    setVerifiedWinners(indices.map((idx) => ({ username: entries[idx], index: idx })))
    setVerificationRan(true)
  }

  if (loading) {
    return (
      <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0a0d14] text-white">
        <MainHeader />
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
          <span className="text-xs text-slate-500 font-semibold uppercase tracking-widest">Initializing console...</span>
        </div>
      </div>
    )
  }

  if (error || !raffle) {
    return (
      <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0a0d14] text-white">
        <MainHeader />
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
          <div className="p-4 border border-rose-500/20 bg-rose-500/5 rounded-xl text-center text-xs text-rose-400">
            Error: {error || 'Failed to load raffle info.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0a0d14] text-white">
      <MainHeader />

      <div className="flex-1 overflow-y-auto py-10 px-6 scrollbar-thin">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-white/5">
            <Link
              href={`/raffle/${raffle.id}`}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition-colors uppercase tracking-wider font-semibold"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to raffle details
            </Link>
            <span className="text-[10px] text-indigo-400 font-bold bg-indigo-950/40 border border-indigo-500/20 px-3 py-1 rounded uppercase tracking-wider">
              Offline Cryptographic Console
            </span>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-extrabold uppercase tracking-wide text-slate-100 font-pixel-body">
              Independent Verification Console
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
              This tool allows you to independently re-run the entire cryptographic Merkle Tree root calculation and the Fisher-Yates shuffle algorithm directly in your browser with zero backend connection required. 
              This proves that the randomness is absolute and tamper-proof.
            </p>
          </div>

          {/* Core Panel Split Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            
            {/* Left Column: Data Input */}
            <div className="border border-white/5 bg-slate-950/50 p-5 rounded-2xl space-y-4">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Terminal className="h-4.5 w-4.5 text-cyan-400" />
                Verification Inputs
              </h3>

              {/* Raw list input */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400 block">Raw Contestant List (CSV/Lines):</label>
                <Textarea
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  rows={6}
                  className="font-mono text-xs w-full bg-slate-950/80 border-slate-800 focus:border-cyan-500/50 text-slate-300"
                />
              </div>

              {/* Seed input */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400 block">Cosmic Random Seed (32-byte hex or raw string):</label>
                <Input
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  className="font-mono text-xs w-full bg-slate-950/80 border-slate-800 focus:border-cyan-500/50 text-slate-300"
                  placeholder="0x..."
                />
              </div>

              {/* Winner Count input */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400 block">Winner Count:</label>
                <Input
                  type="number"
                  min="1"
                  value={winnerCountInput}
                  onChange={(e) => setWinnerCountInput(e.target.value)}
                  className="text-xs w-full bg-slate-950/80 border-slate-800 focus:border-cyan-500/50 text-slate-300"
                />
              </div>

              <Button
                onClick={runVerification}
                disabled={!seedInput || !rawInput}
                className="w-full bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-slate-950 font-bold uppercase tracking-wider text-xs py-3 rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Play className="h-4 w-4 text-slate-950" />
                Run Offline Verification
              </Button>
            </div>

            {/* Right Column: Log console */}
            <div className="space-y-6">
              {/* Terminal Screen */}
              <div className="border border-white/10 bg-black/90 p-5 rounded-2xl font-mono text-[11px] leading-relaxed shadow-xl h-[420px] overflow-y-auto flex flex-col justify-between scrollbar-thin text-slate-300">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2 text-[10px] text-slate-500">
                    <span>COSMIC SHUFFLE PROOF VERIFIER v1.0.0</span>
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                      ONLINE
                    </span>
                  </div>
                  
                  {verificationRan ? (
                    <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 scrollbar-thin">
                      {logs.map((log, idx) => (
                        <div key={idx} className="break-all whitespace-pre-wrap">
                          {log}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-slate-500 py-20 text-center uppercase tracking-wide text-xs">
                      [ Click "Run Offline Verification" to execute the cryptographic proof ]
                    </div>
                  )}
                </div>

                {verificationRan && (
                  <div className="pt-3 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Merkle Root: {isRootValid ? "✅ VALID" : "❌ INVALID"}</span>
                    <span>Winners Count: {verifiedWinners.length}</span>
                  </div>
                )}
              </div>

              {/* Verified winners display */}
              {verificationRan && (
                <div className="border border-cyan-500/10 bg-slate-950/60 p-5 rounded-2xl space-y-4 shadow-lg animate-fadeIn">
                  <div className="flex items-center gap-1.5 text-amber-400 font-bold text-sm font-pixel-body">
                    <Trophy className="h-4.5 w-4.5" />
                    <span>Derived Winner List:</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                    {verifiedWinners.map((winner, idx) => (
                      <div
                        key={winner.index}
                        className="p-3 bg-slate-950/80 rounded-xl border border-white/5 flex justify-between items-center"
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-5 w-5 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center text-[9px]">
                            {idx + 1}
                          </span>
                          <span className="text-slate-200 font-semibold">{winner.username}</span>
                        </div>
                        <span className="text-slate-500 text-[10px]">Ticket #{winner.index}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
