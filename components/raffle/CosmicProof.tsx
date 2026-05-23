'use client'

import { Shield, Sparkles, Orbit, Compass, Trophy, FileText, Cpu, Loader2, ExternalLink } from 'lucide-react'

interface CosmicProofProps {
  merkleRoot: string
  commitBlock: number
  seed?: string | null
  drawn: boolean
  txHash?: string | null
  contractAddress?: string | null
}

export function CosmicProof({ merkleRoot, commitBlock, seed, drawn, txHash, contractAddress }: CosmicProofProps) {
  const explorerUrl = process.env.NEXT_PUBLIC_ARC_EXPLORER || 'https://testnet.arcscan.app'

  return (
    <div className="border border-white/5 bg-slate-950/40 rounded-2xl p-5 space-y-6">
      <div className="pb-3 border-b border-white/5 flex items-center justify-between">
        <h4 className="text-sm font-bold uppercase tracking-wider text-slate-200 font-pixel-body flex items-center gap-1.5">
          <Shield className="h-4.5 w-4.5 text-cyan-400" />
          Provably-Fair Verifiability Diagram
        </h4>
        <span className="text-[9px] text-cyan-400 font-bold bg-cyan-950/40 border border-cyan-500/20 px-2 py-0.5 rounded tracking-wide uppercase">
          Verifiable Proof Chain
        </span>
      </div>

      {/* Concise English Fairness Explanation */}
      <div className="p-4 border border-cyan-500/20 bg-cyan-950/15 rounded-xl space-y-2 animate-fadeIn">
        <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-400 uppercase tracking-wider">
          <Sparkles className="h-4 w-4 text-cyan-400 animate-pulse" />
          Why is this 100% Fair &amp; Transparent?
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
          Our drawing engine mixes physical <strong>Satellite Cosmic Ray Entropy (SpaceComputer cTRNG)</strong> with the <strong>On-Chain Block Hash Entropy</strong> of a future block to derive a completely ungameable Cosmic Seed. Since all contestant lists are frozen cryptographically into a <strong>Merkle Tree Root</strong> on the smart contract before drawing, outcomes can never be predicted or tampered with. Anyone can verify the results independently on-chain!
        </p>
      </div>

      {/* Grid of Steps */}
      <div className="space-y-4 text-xs">
        {/* Step 1: Merkle Root Pipeline */}
        <div className="relative pl-7 before:absolute before:left-2.5 before:top-6 before:bottom-0 before:w-px before:bg-gradient-to-b before:from-cyan-500/50 before:to-indigo-500/20">
          <div className="absolute left-0 top-0.5 h-5.5 w-5.5 rounded-full bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <FileText className="h-3 w-3" />
          </div>
          <div className="space-y-1.5">
            <h5 className="font-semibold text-slate-200 flex items-center gap-1.5">
              1. Initialize &amp; Freeze Entry List
            </h5>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              The list of participating contestants is normalized and sorted in a deterministic lexicographical order to construct a cryptographic **Merkle Tree**. 
              The baseline **Merkle Root** hash is committed and permanently stored on the smart contract upon creation.
            </p>
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-white/5 font-mono text-[10px] break-all select-all text-cyan-400/90 max-w-full">
              Root: {merkleRoot}
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

        {/* Step 2: Randomness Target Block */}
        <div className="relative pl-7 before:absolute before:left-2.5 before:top-6 before:bottom-0 before:w-px before:bg-gradient-to-b before:from-indigo-500/50 before:to-amber-500/20">
          <div className="absolute left-0 top-0.5 h-5.5 w-5.5 rounded-full bg-indigo-950/80 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <Compass className="h-3 w-3" />
          </div>
          <div className="space-y-1.5">
            <h5 className="font-semibold text-slate-200 flex items-center gap-1.5">
              2. Future Block Anchor Target
            </h5>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              The raffle assigns a unique future target **Block #{commitBlock}** on the Arc Network. 
              The smart contract draws block hash entropy only after this target block is mined, preventing any pre-drawing manipulation.
            </p>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-950/40 border border-indigo-500/20 rounded-lg text-indigo-300 font-semibold text-[10px] uppercase font-mono">
              Space Random Block Target: #{commitBlock}
            </div>
          </div>
        </div>

        {/* Step 3: Draw execution */}
        <div className="relative pl-7">
          <div className="absolute left-0 top-0.5 h-5.5 w-5.5 rounded-full bg-amber-950/80 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Cpu className="h-3 w-3" />
          </div>
          <div className="space-y-1.5">
            <h5 className="font-semibold text-slate-200 flex items-center gap-1.5">
              3. Cosmic Entropy &amp; Fisher-Yates Draw
            </h5>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              Once the target block is mined, its block hash combined with **SpaceComputer cTRNG** 
              produces a unique, unpredictable **Cosmic Seed**. 
              The on-chain contract runs a secure, verifiable **Fisher-Yates Shuffle** to pick winning indices in a completely transparent manner.
            </p>
            {drawn && seed ? (
              <div className="space-y-2">
                <div className="bg-slate-950/80 p-2.5 rounded-xl border border-white/5 font-mono text-[10px] text-slate-400">
                  <span className="text-slate-600 block uppercase text-[8px] font-semibold tracking-wider">Cosmic Random Seed (Keccak256):</span>
                  <span className="text-amber-400/90 block truncate select-all">{seed}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-0.5">
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
                  <a
                    href="https://ipfs.io/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold"
                  >
                    Verify SpaceComputer IPFS Beacon
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="text-[10px] text-slate-500 bg-slate-950/30 p-2.5 rounded border border-dashed border-white/5 flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-600" />
                  Waiting for target block hash to derive Cosmic Seed...
                </div>
                <div>
                  <a
                    href="https://ipfs.io/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold"
                  >
                    Check SpaceComputer IPFS Beacon
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
