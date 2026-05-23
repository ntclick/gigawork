'use client'

import { useState } from 'react'
import { FileSpreadsheet, AlertCircle, Loader2, ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface Step2Data {
  rawInput: string
  entries: string[]
  merkleRoot: string
  commitBlock: number
  totalEntries: number
}

interface Step2ListProps {
  winnerCount: number
  data: Step2Data
  onPrev: () => void
  onNext: (updatedData: Step2Data) => void
}

export function Step2List({ winnerCount, data, onPrev, onNext }: Step2ListProps) {
  const [rawInput, setRawInput] = useState(data.rawInput)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [previewData, setPreviewData] = useState<Step2Data | null>(
    data.merkleRoot ? data : null
  )

  const handleValidate = async () => {
    setError('')
    setLoading(true)
    setPreviewData(null)

    if (!rawInput.trim()) {
      setError('Please enter or upload a list of contestants.')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/raffles/prepare-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawInput,
          winnerCount,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Error preparing contestant list.')
      }

      setPreviewData({
        rawInput,
        entries: json.entries,
        merkleRoot: json.merkleRoot,
        commitBlock: json.commitBlock,
        totalEntries: json.totalEntries,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while processing.')
    } finally {
      setLoading(false)
    }
  }

  const handleNextStep = () => {
    if (previewData) {
      onNext(previewData)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <FileSpreadsheet className="h-3.5 w-3.5 text-cyan-400" />
            Contestant List <span className="text-rose-500">*</span>
          </label>
          <p className="text-xs text-slate-500 mb-2">
            Enter one name or wallet address per line, or paste CSV contents (the first column will be extracted as username). Duplicates are automatically removed.
          </p>
          <Textarea
            value={rawInput}
            onChange={(e) => {
              setRawInput(e.target.value)
              setPreviewData(null) // clear preview if raw input changes
            }}
            placeholder="e.g.:&#10;user_alpha&#10;user_beta&#10;0x9876...&#10;user_gamma,3"
            rows={8}
            className="w-full font-mono bg-slate-950/80 border-slate-800 text-slate-200 focus:border-cyan-500/50"
            disabled={loading}
          />
        </div>

        {error && (
          <div className="p-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Validation Button */}
        {!previewData && (
          <Button
            type="button"
            onClick={handleValidate}
            disabled={loading || !rawInput.trim()}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                Processing and generating Merkle Tree...
              </span>
            ) : (
              'Process & Generate Merkle Root'
            )}
          </Button>
        )}

        {/* Preview Panel */}
        {previewData && (
          <div className="p-5 border border-cyan-500/20 bg-cyan-950/10 rounded-xl space-y-4 animate-fadeIn">
            <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
              <ShieldCheck className="h-5 w-5" />
              <span>List Validated Successfully!</span>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-950/50 p-2.5 rounded border border-white/5">
                <span className="text-slate-500 block">Total Contestants:</span>
                <strong className="text-slate-200 text-sm">{previewData.totalEntries}</strong>
              </div>
              <div className="bg-slate-950/50 p-2.5 rounded border border-white/5">
                <span className="text-slate-500 block">Configured Winners:</span>
                <strong className="text-amber-400 text-sm">{winnerCount}</strong>
              </div>
            </div>

            {/* Merkle Root */}
            <div className="bg-slate-950/50 p-3 rounded border border-white/5 text-xs font-mono">
              <span className="text-slate-500 block mb-1">Cryptographic Merkle Root:</span>
              <span className="text-cyan-300 block truncate">{previewData.merkleRoot}</span>
            </div>

            {/* Target Commit Block */}
            <div className="bg-slate-950/50 p-3 rounded border border-white/5 text-xs">
              <span className="text-slate-500 block mb-1">Target Space Random Block:</span>
              <span className="text-indigo-400 font-semibold">
                Block #{previewData.commitBlock}
              </span>
              <span className="text-slate-500 block mt-0.5 text-[10px]">
                (Target block in ~10 blocks on Arc Testnet to guarantee absolute non-manipulability)
              </span>
            </div>

            {/* List preview */}
            <div className="bg-slate-950/60 rounded border border-white/5 p-3">
              <span className="text-slate-500 block text-xs mb-2">Preview (First 5 entries):</span>
              <div className="max-h-24 overflow-y-auto space-y-1 font-mono text-[11px] text-slate-400 scrollbar-thin">
                {previewData.entries.slice(0, 5).map((entry, index) => (
                  <div key={index} className="flex justify-between px-2 py-0.5 hover:bg-white/5 rounded">
                    <span>{entry}</span>
                    <span className="text-slate-600">index: {index}</span>
                  </div>
                ))}
                {previewData.entries.length > 5 && (
                  <div className="text-center text-slate-600 pt-1 text-[10px]">
                    ... and {previewData.entries.length - 5} other contestants ...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex justify-between items-center pt-2">
        <Button
          type="button"
          onClick={onPrev}
          disabled={loading}
          className="flex items-center gap-1 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 text-xs px-4 py-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <Button
          type="button"
          onClick={handleNextStep}
          disabled={loading || !previewData}
          className="flex items-center gap-1.5 bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-slate-950 font-bold uppercase tracking-wider text-xs px-6 py-2.5 rounded-lg shadow-lg disabled:opacity-50"
        >
          Confirm &amp; Deploy
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
