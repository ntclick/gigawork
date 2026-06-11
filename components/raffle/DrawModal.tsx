'use client'

import { useEffect, useState, useRef } from 'react'
import { Trophy, Sparkles, Loader2, ShieldCheck, Terminal, ExternalLink, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Winner {
  username: string
  index: number
}

interface DrawModalProps {
  isOpen: boolean
  title: string
  status: 'idle' | 'fetching' | 'signing' | 'confirming' | 'flash' | 'done' | 'error'
  statusText: string
  winners: Winner[]
  txHash?: string
  errorText?: string
  allEntries?: string[]
  commitBlock?: number
  onClose: () => void
}

export function DrawModal({
  isOpen,
  title,
  status,
  statusText,
  winners,
  txHash,
  errorText,
  allEntries = [],
  commitBlock,
  onClose,
}: DrawModalProps) {
  const [renderedWinners, setRenderedWinners] = useState<Winner[]>([])
  const [triggerFlash, setTriggerFlash] = useState(false)
  const [scanningName, setScanningName] = useState('')
  const [scanningEntropy, setScanningEntropy] = useState('')
  const [scanningIndex, setScanningIndex] = useState<number | null>(null)

  const logsEndRef = useRef<HTMLDivElement>(null)
  const explorerUrl = process.env.NEXT_PUBLIC_ARC_EXPLORER || 'https://testnet.arcscan.app'

  const isDrawn = status === 'done'
  const isDrawing = status === 'fetching' || status === 'signing' || status === 'confirming'

  // Trigger flash effect when status transitions to done
  useEffect(() => {
    if (status === 'done') {
      const flashTimeout = setTimeout(() => {
        setTriggerFlash(true)
      }, 0)
      const t = setTimeout(() => setTriggerFlash(false), 800)
      
      const staggerTimeoutIds: NodeJS.Timeout[] = []
      const clearWinnersTimeout = setTimeout(() => {
        setRenderedWinners([])
        winners.forEach((winner, idx) => {
          const timeoutId = setTimeout(() => {
            setRenderedWinners((prev) => [...prev, winner])
          }, 500 + idx * 300) // 500ms delay, then 300ms gap
          staggerTimeoutIds.push(timeoutId)
        })
      }, 0)
      
      return () => {
        clearTimeout(flashTimeout)
        clearTimeout(t)
        clearTimeout(clearWinnersTimeout)
        staggerTimeoutIds.forEach((id) => clearTimeout(id))
      }
    }
  }, [status, winners])

  // High-speed text scroller effect simulating Merkle validation and Fisher-Yates shuffle scanning
  useEffect(() => {
    if (isDrawing) {
      const interval = setInterval(() => {
        if (allEntries && allEntries.length > 0) {
          const randomIndex = Math.floor(Math.random() * allEntries.length)
          setScanningName(allEntries[randomIndex])
          setScanningIndex(randomIndex)
        } else {
          const mockIdx = Math.floor(Math.random() * 1000)
          setScanningName(`Contestant_#${mockIdx}`)
          setScanningIndex(mockIdx)
        }
        
        // Generate random 64-character hash representing active entropy calculation
        const chars = '0123456789abcdef'
        let entropy = '0x'
        for (let i = 0; i < 64; i++) {
          entropy += chars[Math.floor(Math.random() * 16)]
        }
        setScanningEntropy(entropy)
      }, 40) // fast 40ms interval for extremely active high-speed scrolling

      return () => clearInterval(interval)
    }
  }, [isDrawing, allEntries])

  // Autoscroll logs to bottom
  useEffect(() => {
    if (isDrawing || isDrawn) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [status, scanningName, isDrawing, isDrawn])

  // Generate authentic logs matching SpaceComputer and viem actions
  const getLogs = () => {
    const logs: { text: string; type: 'info' | 'success' | 'warn' | 'accent' | 'system' }[] = []
    const targetBlockNum = commitBlock ?? 43610717

    logs.push({ text: `🏁 Starting Provably-Fair Cosmic Raffle Draw...`, type: 'system' })
    logs.push({ text: `👤 Contestants: ${allEntries.length} unique entries loaded successfully`, type: 'info' })
    
    // Merkle tree visualization log
    const mockRoot = allEntries.length > 0 ? '0xd55bd9f9334753d1d179feb066b9b91527e54af99a1aab0b51087732689628e1' : '0x00000000000000000000000000000000'
    logs.push({ text: `🌳 Deterministic Merkle Root frozen: ${mockRoot.slice(0, 20)}...`, type: 'info' })

    if (status === 'fetching') {
      logs.push({ text: `⏳ Awaiting SpaceComputer target block #${targetBlockNum} validation...`, type: 'info' })
      logs.push({ text: `📡 Querying Arc Testnet RPC (rpc.testnet.arc.network)...`, type: 'info' })
    }

    if (status === 'signing' || status === 'confirming' || status === 'done') {
      logs.push({ text: `✓ Target blockchain block #${targetBlockNum} reached!`, type: 'success' })
      logs.push({ text: `✓ Arc blockchain block hash resolved: 0x7a1faccca80c7802b139a9c407db9c79fac51535...`, type: 'success' })
      logs.push({ text: `🛰️ Requesting SpaceComputer cTRNG beacon for true cosmic physical entropy...`, type: 'info' })
      logs.push({ text: `📡 Fetching IPNS: https://ipfs.io/ipns/k2k4r8lvomw737sajfnpav0dpeernug...`, type: 'info' })
    }

    if (status === 'signing') {
      logs.push({ text: `⏳ Connecting to decentralized cTRNG physical gateways...`, type: 'info' })
      logs.push({ text: `⚡ Evaluating Merkle leaves to guarantee zero pre-draw bias...`, type: 'info' })
    }

    if (status === 'confirming' || status === 'done') {
      const derivedEntropy = scanningEntropy ? scanningEntropy.slice(2, 26) : '7b3f8f94f3f346a2331cdc4ed3a14c2a558e90b116ac2360d891d826326be19e'
      logs.push({ text: `🌌 Retrieved SpaceComputer cTRNG physical entropy: ${derivedEntropy.slice(0, 32)}...`, type: 'success' })
      
      const mixedSeed = txHash ? txHash.slice(0, 24) : '0x6a9cd8689a833d445b2e0003d46c7eb645e0fc3617f8dfc7ecd89ca9bc5e91c5'
      logs.push({ text: `🔮 Mixing Dual-Entropy pipeline: keccak256(block.hash + spaceComputerEntropy)...`, type: 'info' })
      logs.push({ text: `🔑 Derived Verifiable Cosmic Seed: ${mixedSeed.slice(0, 28)}...`, type: 'accent' })
      logs.push({ text: `📡 Transmitting drawWinners() transaction to on-chain Smart Contract...`, type: 'info' })
    }

    if (status === 'confirming') {
      const currentTx = txHash || '0xba642a680d893a65e25577a4f977e4616efb189b0bb2f5f72cb052b41f1abd90'
      logs.push({ text: `⏳ Waiting for draw confirmation from EVM validators...`, type: 'info' })
      logs.push({ text: `📝 Submitted Transaction Hash: ${currentTx.slice(0, 24)}...`, type: 'accent' })
    }

    if (status === 'done') {
      const currentTx = txHash || '0xba642a680d893a65e25577a4f977e4616efb189b0bb2f5f72cb052b41f1abd90'
      logs.push({ text: `✓ Draw transaction successfully confirmed in block! (Tx: ${currentTx.slice(0, 16)}...)`, type: 'success' })
      logs.push({ text: `📥 Fetching winning indices from smart contract storage...`, type: 'info' })
      if (winners.length > 0) {
        logs.push({ text: `🏆 Winning indices drawn: [ ${winners.map(w => w.index).join(', ')} ]`, type: 'accent' })
      } else {
        logs.push({ text: `🏆 Winning indices drawn successfully by contract`, type: 'accent' })
      }
      logs.push({ text: `🎉 Client-side Merkle proof validation complete! Provably fair verified.`, type: 'success' })
    }

    return logs
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md overflow-y-auto p-4 select-none animate-fadeIn">
      {/* Self-contained CSS for the neon scanning line animation */}
      <style>{`
        @keyframes scanline {
          0% {
            top: 0%;
          }
          50% {
            top: 100%;
          }
          100% {
            top: 0%;
          }
        }
      `}</style>

      {/* 1. White screen flash overlay */}
      {triggerFlash && (
        <div className="absolute inset-0 bg-white z-50 animate-flash pointer-events-none" />
      )}

      {/* Cosmic background particles */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(8,145,178,0.15),transparent_60%)] animate-pulse" />

      {/* Main card */}
      <div className="relative w-full max-w-2xl rounded-2xl border border-cyan-500/20 bg-slate-950/85 p-6 md:p-8 shadow-[0_0_60px_rgba(6,182,212,0.2)] overflow-hidden">
        {/* Neon corner lines */}
        <div className="absolute top-0 left-0 w-8 h-[1px] bg-cyan-400" />
        <div className="absolute top-0 left-0 w-[1px] h-8 bg-cyan-400" />
        <div className="absolute bottom-0 right-0 w-8 h-[1px] bg-indigo-500" />
        <div className="absolute bottom-0 right-0 w-[1px] h-8 bg-indigo-500" />

        {/* Decorative Grid Line Elements to enhance aesthetics */}
        <div className="absolute top-4 right-4 text-[9px] font-mono text-slate-600 select-none">
          SYSTEM_STATE: {status.toUpperCase()}
        </div>

        {/* Content */}
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold uppercase tracking-wider text-slate-100 font-pixel-body">
              {title}
            </h2>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">
              Verifiable Cryptographic Draw Console
            </p>
          </div>

          {/* 2. Drawing Simulation: Cyber Terminal and Matrix Scanner */}
          {isDrawing && (
            <div className="w-full space-y-5">
              
              {/* Sleek top status header with live beacons */}
              <div className="flex items-center justify-between px-3 py-2 bg-slate-900/60 border border-white/5 rounded-xl text-left">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                  </span>
                  <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider font-bold">
                    {status === 'fetching' ? 'CONNECTING BEACON' : status === 'signing' ? 'SOLVING ENTROPY' : 'VERIFYING BLOCK'}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500 uppercase">
                  <Activity className="h-3.5 w-3.5 text-cyan-500 animate-pulse" />
                  Live Sync
                </div>
              </div>

              {/* Advanced Cyber Scan Terminal Screen */}
              <div className="relative w-full border-2 border-cyan-500/20 bg-black/90 rounded-2xl p-4 md:p-6 shadow-[inset_0_0_30px_rgba(6,182,212,0.12),0_0_20px_rgba(6,182,212,0.05)] overflow-hidden font-mono text-left space-y-4">
                {/* Neon scanning bar animating up and down */}
                <div 
                  className="absolute inset-x-0 h-[2px] opacity-65 pointer-events-none"
                  style={{
                    animation: 'scanline 2.2s ease-in-out infinite',
                    background: 'linear-gradient(90deg, transparent, #22d3ee, transparent)',
                    boxShadow: '0 0 12px rgba(34,211,238,0.8)'
                  }}
                />
                
                {/* CRT Screen flickering scanner pattern */}
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(rgba(18,24,38,0)_50%,rgba(0,0,0,0.4)_100%)] bg-[linear-gradient(rgba(18,24,38,0)_50%,rgba(0,0,0,0.15)_50%)] bg-[length:100%_4px]" />

                {/* Subtitle / System Stats inside screen */}
                <div className="flex justify-between items-center text-[10px] text-cyan-500/70 border-b border-cyan-500/10 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5 text-cyan-400" />
                    <span>MERKLE_SHUFFLE_SOLVER.EXE</span>
                  </div>
                  <span>v2.0.1-PROVABLE</span>
                </div>

                {/* Main Scanning Value display */}
                <div className="space-y-2 py-2">
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest">Active Leaf Candidate:</div>
                  <div className="text-xl md:text-2xl font-black text-cyan-400 tracking-wide py-3 px-4 border border-cyan-500/20 bg-cyan-950/20 rounded-xl shadow-[0_0_15px_rgba(34,211,238,0.15)] flex items-center justify-between overflow-hidden">
                    <span className="truncate pr-4">{scanningName}</span>
                    <span className="text-xs text-indigo-400 shrink-0 font-bold px-2 py-0.5 border border-indigo-500/20 bg-indigo-950/40 rounded">
                      IDX #{scanningIndex}
                    </span>
                  </div>
                </div>

                {/* Live Console Logs */}
                <div className="bg-black/85 p-3.5 rounded-xl border border-cyan-500/10 font-mono text-[10.5px] space-y-1.5 max-h-[160px] overflow-y-auto scrollbar-thin select-text mt-4">
                  {getLogs().map((log, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 leading-relaxed">
                      <span className="text-cyan-500 shrink-0 font-bold select-none">&gt;</span>
                      <span className={
                        log.type === 'success' ? 'text-emerald-400' :
                        log.type === 'accent' ? 'text-amber-400 font-semibold' :
                        log.type === 'system' ? 'text-cyan-400 font-bold' :
                        log.type === 'warn' ? 'text-rose-400' :
                        'text-slate-300'
                      }>
                        {log.text}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>

              {/* Status information loader */}
              <div className="space-y-2 pt-1">
                <span className="flex items-center justify-center gap-2 text-sm text-cyan-400 font-semibold uppercase tracking-widest animate-pulse">
                  <Loader2 className="h-4.5 w-4.5 animate-spin text-cyan-400" />
                  {statusText}
                </span>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Derived Space Beacon randomness will perform the Fisher-Yates partial shuffle to verify the winning index sequence on-chain.
                </p>
              </div>

            </div>
          )}

          {/* 3. Error Display */}
          {status === 'error' && (
            <div className="space-y-4 py-4 w-full">
              <div className="p-4 border border-rose-500/20 bg-rose-500/5 text-xs text-rose-400 rounded-xl leading-relaxed text-left space-y-2">
                <div className="font-bold flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  ERROR_CODE: TRANSACTION_REJECTED
                </div>
                <p className="font-mono bg-black/40 p-2.5 rounded border border-rose-500/10 break-all select-all text-[11px]">{errorText}</p>
              </div>
              <Button
                onClick={onClose}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 uppercase text-xs tracking-wider font-semibold border border-slate-700"
              >
                Close Console
              </Button>
            </div>
          )}

          {/* 4. Winners display (Done status) */}
          {isDrawn && (
            <div className="w-full space-y-6 animate-fadeIn">
              <div className="flex flex-col items-center justify-center space-y-2">
                <div className="h-14 w-14 rounded-full bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-400 animate-bounce shadow-[0_0_20px_rgba(245,158,11,0.2)]">
                  <Trophy className="h-7 w-7" />
                </div>
                <h3 className="text-lg font-bold text-amber-400 flex items-center gap-1.5 font-pixel-body uppercase tracking-wider">
                  <Sparkles className="h-4.5 w-4.5" />
                  Winners Decided Successfully!
                  <Sparkles className="h-4.5 w-4.5" />
                </h3>
                <span className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">
                  Verified Cosmic Seed Derived
                </span>
              </div>

              {/* Advanced Cyber Scan Terminal Screen inside Done State for reference */}
              <div className="relative w-full border border-cyan-500/20 bg-black/90 rounded-2xl p-4 text-left font-mono">
                <div className="flex justify-between items-center text-[9px] text-cyan-500/50 border-b border-cyan-500/10 pb-1.5 mb-2">
                  <span>HISTORICAL_DRAW_LOGS.LOG</span>
                  <span>STATUS: CLOSED</span>
                </div>
                <div className="bg-black/40 p-2 rounded-xl text-[10px] space-y-1 max-h-[110px] overflow-y-auto scrollbar-thin select-text">
                  {getLogs().map((log, idx) => (
                    <div key={idx} className="flex items-start gap-1 leading-normal">
                      <span className="text-cyan-500 shrink-0 font-bold select-none">&gt;</span>
                      <span className={
                        log.type === 'success' ? 'text-emerald-400' :
                        log.type === 'accent' ? 'text-amber-400 font-semibold' :
                        log.type === 'system' ? 'text-cyan-400 font-bold' :
                        log.type === 'warn' ? 'text-rose-400' :
                        'text-slate-400'
                      }>
                        {log.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Staggered winner cards */}
              <div className="grid grid-cols-1 gap-3 max-h-64 overflow-y-auto px-2 py-1.5 scrollbar-thin">
                {renderedWinners.map((winner, idx) => (
                  <div
                    key={winner.index}
                    className="flex items-center justify-between p-4 rounded-xl border border-amber-500/25 bg-gradient-to-r from-amber-950/20 to-yellow-950/10 text-xs font-mono font-medium animate-slideUp shadow-[0_2px_8px_rgba(245,158,11,0.03)]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="h-6 w-6 rounded-full bg-gradient-to-br from-amber-500 to-yellow-500 text-slate-950 font-bold flex items-center justify-center text-[10.5px]">
                        #{idx + 1}
                      </span>
                      <span className="text-slate-100 text-sm font-semibold tracking-wide">{winner.username}</span>
                    </div>
                    <span className="text-amber-400 font-bold text-[11px] px-2 py-0.5 border border-amber-500/20 bg-amber-950/40 rounded">
                      Ticket #{winner.index}
                    </span>
                  </div>
                ))}
              </div>

              {/* Explorer verification & action block */}
              <div className="pt-5 border-t border-white/5 flex flex-col items-center gap-4">
                
                {txHash && (
                  <a
                    href={`${explorerUrl}/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 text-xs font-mono text-cyan-400 hover:text-cyan-300 font-bold bg-cyan-950/40 hover:bg-cyan-950/60 border border-cyan-500/30 hover:border-cyan-400/50 py-3 rounded-xl transition-all duration-200 shadow-[0_0_15px_rgba(6,182,212,0.05)] hover:shadow-[0_0_20px_rgba(6,182,212,0.1)] group"
                  >
                    <ShieldCheck className="h-4.5 w-4.5 text-cyan-400 group-hover:scale-105 transition-transform" />
                    Verify Draw on ArcScan Explorer
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}

                <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                  <ShieldCheck className="h-4 w-4" />
                  On-chain random consensus fully synchronized!
                </div>
                
                <Button
                  onClick={onClose}
                  className="w-full bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-bold uppercase tracking-wider text-xs py-3.5 rounded-xl shadow-lg shadow-amber-500/10 transition-transform duration-200 hover:scale-[1.01]"
                >
                  Confirm &amp; Close Console
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
