'use client'

import { useState } from 'react'
import { Trophy, Gift, AlignLeft, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface Step1Data {
  title: string
  description: string
  prizeDescription: string
  winnerCount: number
}

interface Step1InfoProps {
  data: Step1Data
  onNext: (updatedData: Partial<Step1Data>) => void
}

export function Step1Info({ data, onNext }: Step1InfoProps) {
  const [title, setTitle] = useState(data.title)
  const [description, setDescription] = useState(data.description)
  const [prizeDescription, setPrizeDescription] = useState(data.prizeDescription)
  const [winnerCount, setWinnerCount] = useState(data.winnerCount > 0 ? String(data.winnerCount) : '1')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!title.trim()) {
      setError('Please enter the raffle title.')
      return
    }

    const count = Number(winnerCount)
    if (isNaN(count) || count <= 0) {
      setError('Winner count must be a number greater than 0.')
      return
    }

    onNext({
      title: title.trim(),
      description: description.trim(),
      prizeDescription: prizeDescription.trim(),
      winnerCount: count,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Gift className="h-3.5 w-3.5 text-cyan-400" />
            Raffle Campaign Title <span className="text-rose-500">*</span>
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Cosmic Giga Giveaway #1"
            className="w-full bg-slate-950/80 border-slate-800 text-slate-200 placeholder-slate-600 focus:border-cyan-500/50"
            required
          />
        </div>

        {/* Prize description */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5 text-amber-400" />
            Prize Description <span className="text-slate-500">(Optional)</span>
          </label>
          <Input
            value={prizeDescription}
            onChange={(e) => setPrizeDescription(e.target.value)}
            placeholder="e.g., 100 USDC + 1 Giga-NFT"
            className="w-full bg-slate-950/80 border-slate-800 text-slate-200 placeholder-slate-600 focus:border-cyan-500/50"
          />
        </div>

        {/* Winner Count */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Settings className="h-3.5 w-3.5 text-indigo-400" />
            Winner Count <span className="text-rose-500">*</span>
          </label>
          <Input
            type="number"
            min="1"
            value={winnerCount}
            onChange={(e) => setWinnerCount(e.target.value)}
            placeholder="1"
            className="w-full bg-slate-950/80 border-slate-800 text-slate-200 focus:border-cyan-500/50"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <AlignLeft className="h-3.5 w-3.5 text-slate-400" />
            Additional Description <span className="text-slate-500">(Optional)</span>
          </label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe this raffle campaign..."
            rows={3}
            className="w-full bg-slate-950/80 border-slate-800 text-slate-200 placeholder-slate-600 focus:border-cyan-500/50"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md">
          {error}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          className="w-full md:w-auto bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-slate-950 font-bold uppercase tracking-wider text-xs px-6 py-2.5 rounded-lg shadow-lg shadow-cyan-500/10 hover:shadow-cyan-500/20 transition-all duration-200"
        >
          Continue
        </Button>
      </div>
    </form>
  )
}
