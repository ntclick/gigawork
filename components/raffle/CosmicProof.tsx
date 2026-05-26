'use client'

import { useState } from 'react'
import { Shield, Sparkles, Orbit, Compass, Trophy, FileText, Cpu, Loader2, ExternalLink, ShieldCheck, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'

interface CosmicProofProps {
  merkleRoot: string
  commitBlock: number
  seed?: string | null
  drawn: boolean
  txHash?: string | null
  contractAddress?: string | null
  cosmicProof?: {
    blockHash: string
    spaceComputerEntropy: string | null
    verificationMode: 'authenticated_sdk' | 'public_sdk_ipfs' | 'fallback_ipfs' | 'rpc_fallback'
    sourceUrl?: string
    timestamp?: number
    sequence?: number | null
    src?: string | null
    service?: string | null
    signature?: {
      algo: string
      value: string
      pk: string
    } | null
  } | null
}

export function CosmicProof({ merkleRoot, commitBlock, seed, drawn, txHash, contractAddress, cosmicProof }: CosmicProofProps) {
  const explorerUrl = process.env.NEXT_PUBLIC_ARC_EXPLORER || 'https://testnet.arcscan.app'
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [showSpaceProof, setShowSpaceProof] = useState(false)

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(label)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const getVerificationModeBadge = () => {
    if (!cosmicProof) return null
    switch (cosmicProof.verificationMode) {
      case 'authenticated_sdk':
        return (
          <span className="text-[9px] text-emerald-400 font-bold bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded shadow-[0_0_8px_rgba(16,185,129,0.1)] flex items-center gap-1 uppercase tracking-wider">
            <Orbit className="h-3 w-3 animate-spin text-emerald-400" />
            Authenticated SDK
          </span>
        )
      case 'public_sdk_ipfs':
      case 'fallback_ipfs':
        return (
          <span className="text-[9px] text-cyan-400 font-bold bg-cyan-950/40 border border-cyan-500/20 px-2 py-0.5 rounded shadow-[0_0_8px_rgba(6,182,212,0.1)] flex items-center gap-1 uppercase tracking-wider">
            <Orbit className="h-3 w-3 text-cyan-400 animate-pulse" />
            IPFS Beacon
          </span>
        )
      case 'rpc_fallback':
        return (
          <span className="text-[9px] text-amber-400 font-bold bg-amber-950/40 border border-amber-500/20 px-2 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider">
            Blockhash Fallback
          </span>
        )
      default:
        return null
    }
  }

  return (
    <div className="border border-white/10 bg-slate-950/75 backdrop-blur-md rounded-2xl p-5 space-y-6 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-300 hover:border-cyan-500/20">
      <div className="pb-3 border-b border-white/10 flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-100 font-pixel-body flex items-center gap-2">
          <Shield className="h-4.5 w-4.5 text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]" />
          Provably-Fair Verifiability Diagram
        </h4>
        <span className="text-[9px] text-cyan-400 font-bold bg-cyan-950/40 border border-cyan-500/25 px-2.5 py-1 rounded tracking-wide uppercase shadow-[0_0_10px_rgba(6,182,212,0.1)]">
          Audit Chain
        </span>
      </div>

      <div className="p-4 border border-cyan-500/20 bg-gradient-to-r from-cyan-950/30 to-indigo-950/20 rounded-xl space-y-2.5 animate-fadeIn shadow-[inset_0_0_15px_rgba(6,182,212,0.05)]">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-400 uppercase tracking-wider">
            <Sparkles className="h-4 w-4 text-cyan-400 animate-pulse" />
            100% Fair &amp; Transparent
          </div>
          {getVerificationModeBadge()}
        </div>
        <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
          Our drawing engine mixes physical <strong>Satellite Cosmic Ray Entropy (SpaceComputer cTRNG)</strong> with the <strong>On-Chain Block Hash Entropy</strong> of a future block to derive a completely ungameable Cosmic Seed. Since all contestant lists are frozen cryptographically into a <strong>Merkle Tree Root</strong> on the smart contract before drawing, outcomes can never be predicted or tampered with. Anyone can verify the results independently on-chain!
        </p>
      </div>

      <div className="space-y-5 text-xs">
        <div className="relative pl-8 before:absolute before:left-2.5 before:top-6 before:bottom-0 before:w-px before:bg-gradient-to-b before:from-cyan-500/40 before:to-indigo-500/20">
          <div className="absolute left-0 top-0.5 h-6 w-6 rounded-full bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.25)]">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <div className="space-y-1.5">
            <h5 className="font-semibold text-slate-200 flex items-center gap-1.5">
              1. Initialize &amp; Freeze Entry List
            </h5>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              The list of participating contestants is normalized and sorted in a deterministic lexicographical order to construct a cryptographic **Merkle Tree**. 
              The baseline **Merkle Root** hash is committed and permanently stored on the smart contract upon creation.
            </p>
            <div className="bg-slate-950/80 p-2 py-1.5 rounded-xl border border-white/5 font-mono text-[9px] break-all select-all text-cyan-400/90 max-w-full flex items-center justify-between">
              <span className="truncate flex-1">{merkleRoot}</span>
              <button 
                onClick={() => handleCopy(merkleRoot, 'merkleRoot')}
                className="ml-2 p-1 text-slate-500 hover:text-cyan-400 transition-colors"
                title="Copy Merkle Root"
              >
                {copiedKey === 'merkleRoot' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>

            {contractAddress && (
              <div className="pt-0.5">
                <a
                  href={`${explorerUrl}/address/${contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 font-medium"
                >
                  View Contract Address
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="relative pl-8 before:absolute before:left-2.5 before:top-6 before:bottom-0 before:w-px before:bg-gradient-to-b before:from-indigo-500/40 before:to-amber-500/20">
          <div className="absolute left-0 top-0.5 h-6 w-6 rounded-full bg-indigo-950/80 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.25)]">
            <Compass className="h-3.5 w-3.5" />
          </div>
          <div className="space-y-2">
            <h5 className="font-semibold text-slate-200 flex items-center gap-1.5">
              2. Future Block Anchor Target
            </h5>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              The raffle assigns a unique future target **Block #{commitBlock}** on the Arc Network. 
              The smart contract draws block hash entropy only after this target block is mined, preventing any pre-drawing manipulation.
            </p>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-950/50 border border-indigo-500/25 rounded-lg text-indigo-300 font-semibold text-[10px] uppercase font-mono shadow-[0_2px_8px_rgba(99,102,241,0.05)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500"></span>
              </span>
              Space Random Block Target: #{commitBlock}
            </div>
          </div>
        </div>

        <div className="relative pl-8">
          <div className="absolute left-0 top-0.5 h-6 w-6 rounded-full bg-amber-950/80 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
            <Cpu className="h-3.5 w-3.5" />
          </div>
          <div className="space-y-2">
            <h5 className="font-semibold text-slate-200 flex items-center gap-1.5">
              3. Cosmic Entropy &amp; Fisher-Yates Draw
            </h5>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Once the target block is mined, its block hash combined with **SpaceComputer cTRNG** 
              produces a unique, unpredictable **Cosmic Seed**. 
              The on-chain contract runs a secure, verifiable **Fisher-Yates Shuffle** to pick winning indices in a completely transparent manner.
            </p>
            {drawn && seed ? (
              <div className="space-y-3">
                <div className="bg-slate-950/90 p-2.5 rounded-xl border border-amber-500/15 font-mono text-[9px] text-slate-300 shadow-[0_0_10px_rgba(245,158,11,0.02)] flex items-center justify-between">
                  <div className="truncate flex-1">
                    <span className="text-slate-500 block uppercase text-[7px] font-semibold tracking-wider mb-0.5">Cosmic Random Seed (Keccak256):</span>
                    <span className="text-amber-400 font-bold block truncate select-all">{seed}</span>
                  </div>
                  <button 
                    onClick={() => handleCopy(seed, 'seed')}
                    className="ml-2 p-1 text-slate-500 hover:text-amber-400 transition-colors"
                  >
                    {copiedKey === 'seed' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>

                {cosmicProof && (
                  <div className="border border-emerald-500/20 bg-emerald-950/5 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setShowSpaceProof(!showSpaceProof)}
                      className="w-full py-2.5 px-3 hover:bg-emerald-950/15 text-[10px] font-bold text-emerald-400 flex items-center justify-between transition-colors border-b border-emerald-500/10"
                    >
                      <span className="flex items-center gap-1.5 uppercase tracking-wider">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
                        SpaceComputer cTRNG Proof
                      </span>
                      {showSpaceProof ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5 animate-bounce" />}
                    </button>

                    {showSpaceProof && (
                      <div className="p-3 bg-slate-950/90 space-y-2 animate-slideDown">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[9px]">
                          <div>
                            <span className="text-slate-500 block text-[7px] uppercase font-semibold">Satellite Hardware (src)</span>
                            <span className="text-slate-300 font-bold">{cosmicProof.src || 'Aptos Orbital Gateway'}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[7px] uppercase font-semibold">Service Type</span>
                            <span className="text-slate-300 font-bold">{cosmicProof.service || 'cTRNG'}</span>
                          </div>
                          <div className="col-span-2 border-t border-white/5 pt-1.5">
                            <span className="text-slate-500 block text-[7px] uppercase font-semibold">Physical Cosmic Entropy</span>
                            <div className="font-mono text-[8px] text-cyan-400 break-all select-all flex items-center justify-between bg-slate-900/60 px-2 py-1 rounded border border-white/5 mt-0.5">
                              <span className="truncate flex-1">{cosmicProof.spaceComputerEntropy || 'Unable to retrieve'}</span>
                              {cosmicProof.spaceComputerEntropy && (
                                <button 
                                  onClick={() => handleCopy(cosmicProof.spaceComputerEntropy || '', 'entropy')}
                                  className="ml-1.5 p-0.5 text-slate-500 hover:text-cyan-400 transition-colors"
                                >
                                  {copiedKey === 'entropy' ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="col-span-2 border-t border-white/5 pt-1.5">
                            <span className="text-slate-500 block text-[7px] uppercase font-semibold">Blockchain Anchor Hash</span>
                            <div className="font-mono text-[8px] text-indigo-400 break-all select-all flex items-center justify-between bg-slate-900/60 px-2 py-1 rounded border border-white/5 mt-0.5">
                              <span className="truncate flex-1">{cosmicProof.blockHash || 'Unable to retrieve'}</span>
                              {cosmicProof.blockHash && (
                                <button 
                                  onClick={() => handleCopy(cosmicProof.blockHash || '', 'blockHash')}
                                  className="ml-1.5 p-0.5 text-slate-500 hover:text-indigo-400 transition-colors"
                                >
                                  {copiedKey === 'blockHash' ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                                </button>
                              )}
                            </div>
                          </div>

                          {cosmicProof.signature && (
                            <>
                              <div className="col-span-2 border-t border-white/5 pt-1.5">
                                <span className="text-slate-500 block text-[7px] uppercase font-semibold">Satellite Signature ({cosmicProof.signature.algo || 'RSA'})</span>
                                <div className="font-mono text-[8px] text-emerald-400 break-all select-all flex items-center justify-between bg-slate-900/60 px-2 py-1 rounded border border-white/5 mt-0.5">
                                  <span className="truncate flex-1">{cosmicProof.signature.value}</span>
                                  <button 
                                    onClick={() => handleCopy(cosmicProof.signature?.value || '', 'signatureValue')}
                                    className="ml-1.5 p-0.5 text-slate-500 hover:text-emerald-400 transition-colors"
                                  >
                                    {copiedKey === 'signatureValue' ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                                  </button>
                                </div>
                              </div>
                              <div className="col-span-2 border-t border-white/5 pt-1.5">
                                <span className="text-slate-500 block text-[7px] uppercase font-semibold">Satellite Hardware Public Key</span>
                                <div className="font-mono text-[8px] text-slate-400 break-all select-all flex items-center justify-between bg-slate-900/60 px-2 py-1 rounded border border-white/5 mt-0.5">
                                  <span className="truncate flex-1">{cosmicProof.signature.pk}</span>
                                  <button 
                                    onClick={() => handleCopy(cosmicProof.signature?.pk || '', 'publicKey')}
                                    className="ml-1.5 p-0.5 text-slate-500 hover:text-slate-300 transition-colors"
                                  >
                                    {copiedKey === 'publicKey' ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-2 pt-0.5">
                  {txHash && (
                    <a
                      href={`${explorerUrl}/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 font-semibold"
                    >
                      View Draw Transaction
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  
                  <div className="w-full border-t border-white/5 pt-2 mt-1 space-y-1">
                    <span className="text-[9px] text-slate-500 font-bold block uppercase tracking-wider">Verify IPNS Beacon Mirrors (Bypass DNS blocks):</span>
                    <div className="flex flex-wrap gap-x-2.5 gap-y-1 font-mono text-[9px]">
                      <a
                        href="https://ipfs.io/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                      >
                        ipfs.io <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                      <span className="text-slate-600">|</span>
                      <a
                        href="https://dweb.link/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                      >
                        dweb.link (path) <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                      <span className="text-slate-600">|</span>
                      <a
                        href="https://gateway.ipfs.io/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                      >
                        gateway.ipfs <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                      <span className="text-slate-600">|</span>
                      <a
                        href="https://trustless-gateway.link/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                      >
                        trustless <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                      <span className="text-slate-600">|</span>
                      <a
                        href="https://k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f.ipns.dweb.link/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                      >
                        dweb (subdomain) <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                      <span className="text-slate-600">|</span>
                      <a
                        href="https://k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f.ipns.4everland.io/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                      >
                        4everland <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="text-[10px] text-slate-400 bg-slate-950/50 p-3 rounded-xl border border-dashed border-white/10 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                  Awaiting anchor block mining to mix entropy...
                </div>
                
                <div className="w-full border-t border-white/5 pt-2 mt-1 space-y-1">
                  <span className="text-[9px] text-slate-500 font-bold block uppercase tracking-wider">Check IPFS Beacon Mirrors:</span>
                  <div className="flex flex-wrap gap-x-2.5 gap-y-1 font-mono text-[9px]">
                    <a
                      href="https://ipfs.io/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                    >
                      ipfs.io <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    <span className="text-slate-600">|</span>
                    <a
                      href="https://dweb.link/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                    >
                      dweb.link (path) <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    <span className="text-slate-600">|</span>
                    <a
                      href="https://gateway.ipfs.io/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                    >
                      gateway.ipfs <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    <span className="text-slate-600">|</span>
                    <a
                      href="https://trustless-gateway.link/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                    >
                      trustless <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    <span className="text-slate-600">|</span>
                    <a
                      href="https://k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f.ipns.dweb.link/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                    >
                      dweb (subdomain) <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    <span className="text-slate-600">|</span>
                    <a
                      href="https://k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f.ipns.4everland.io/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-0.5"
                    >
                      4everland <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
