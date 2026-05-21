'use client'

import { useState, useEffect } from 'react'
import { Calendar, CheckCircle2, Clock, Loader2, X } from 'lucide-react'

type DeployModalProps = {
  isOpen: boolean
  onClose: () => void
  workflowId: string
  workflowTitle: string
}

const CRON_OPTIONS = [
  { label: 'Every 10 Minutes', value: '*/10 * * * *', description: 'Real-time automation' },
  { label: 'Every 30 Minutes', value: '*/30 * * * *', description: 'Balanced frequency' },
  { label: 'Hourly', value: '0 * * * *', description: 'Standard cron cycle' },
  { label: 'Every 6 Hours', value: '0 */6 * * *', description: 'Occasional tasks' },
  { label: 'Daily', value: '0 0 * * *', description: 'End-of-day reports' },
]

export function DeployModal({ isOpen, onClose, workflowId, workflowTitle }: DeployModalProps) {
  const [selectedCron, setSelectedCron] = useState('*/30 * * * *')
  const [step, setStep] = useState<'config' | 'deploying' | 'success' | 'error'>('config')
  const [currentProgressStep, setCurrentProgressStep] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')

  const progressSteps = [
    'Analyzing workflow nodes and triggers...',
    'Securing escrow sandbox environment...',
    'Registering cron task with Hermes...',
    'Finalizing deployment...'
  ]

  // Simulate deployment progress
  useEffect(() => {
    if (step !== 'deploying') return

    const timer = setInterval(() => {
      setCurrentProgressStep((prev) => {
        if (prev < progressSteps.length - 1) {
          return prev + 1
        } else {
          clearInterval(timer)
          return prev
        }
      })
    }, 1200)

    return () => clearInterval(timer)
  }, [step])

  if (!isOpen) return null

  const handleDeploy = async () => {
    setStep('deploying')
    setCurrentProgressStep(0)
    setErrorMsg('')

    try {
      // Simulate delay for first steps
      await new Promise((resolve) => setTimeout(resolve, 3600))

      const response = await fetch(`/api/workflow/${workflowId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cronExpression: selectedCron }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || `HTTP ${response.status}`)
      }

      // Finish progress animation
      setCurrentProgressStep(progressSteps.length - 1)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      setStep('success')
    } catch (err: unknown) {
      console.error('Failed to deploy workflow:', err)
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }

  const handleClose = () => {
    // Reset state and close
    setStep('config')
    setCurrentProgressStep(0)
    setErrorMsg('')
    onClose()
  }

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md transition-all duration-300"
      onClick={handleClose}
    >
      <div 
        className="w-full max-w-lg overflow-hidden border border-[var(--giga-accent)] bg-[#12101f]/95 shadow-[0_8px_32px_rgba(255,204,77,0.25)] rounded-none"
        style={{ imageRendering: 'pixelated' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-[#17142b] px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xl text-[var(--giga-accent)]">📉</span>
            <h3 className="font-pixel-header text-sm tracking-wider uppercase text-white">Deploy Workflow</h3>
          </div>
          <button 
            type="button" 
            onClick={handleClose}
            className="text-white/60 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'config' && (
            <div className="space-y-6">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Workflow Target</p>
                <div className="bg-black/40 border border-white/5 p-3 font-pixel-body text-sm text-white/80">
                  {workflowTitle}
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40 mb-3 flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> Select Run Interval
                </p>
                <div className="space-y-2">
                  {CRON_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSelectedCron(opt.value)}
                      className={`w-full flex items-center justify-between p-3.5 border transition-all text-left group ${
                        selectedCron === opt.value
                          ? 'border-[var(--giga-accent)] bg-[var(--giga-accent)]/10 text-white'
                          : 'border-white/5 bg-black/20 text-white/60 hover:border-white/20 hover:bg-black/35 hover:text-white'
                      }`}
                    >
                      <div>
                        <div className="font-pixel-body text-xs text-white group-hover:text-[var(--giga-accent)] transition-colors">
                          {opt.label}
                        </div>
                        <div className="text-[10px] text-white/40 font-mono mt-0.5">
                          {opt.value}
                        </div>
                      </div>
                      <div className="text-[10px] font-pixel-body text-white/40 group-hover:text-white/60">
                        {opt.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 border border-white/20 px-4 py-2.5 font-pixel-body text-xs text-white hover:bg-white/5 active:scale-95 transition-all"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={handleDeploy}
                  className="flex-1 bg-[var(--giga-accent)] px-4 py-2.5 font-pixel-body text-xs text-black font-bold hover:bg-yellow-300 active:scale-95 transition-all shadow-[2px_2px_0_0_#000]"
                >
                  DEPLOY TO HERMES
                </button>
              </div>
            </div>
          )}

          {step === 'deploying' && (
            <div className="space-y-6 py-4 flex flex-col items-center">
              <Loader2 className="h-10 w-10 animate-spin text-[var(--giga-accent)]" />
              <div className="w-full">
                <p className="text-center font-pixel-body text-xs text-[var(--giga-accent)] animate-pulse mb-4">
                  HERMES IS DEPLOYING WORKFLOW...
                </p>

                {/* Progress bar */}
                <div className="w-full h-3 bg-black/50 border border-white/10 p-0.5 mb-6">
                  <div 
                    className="h-full bg-[var(--giga-accent)] transition-all duration-1000"
                    style={{ width: `${((currentProgressStep + 1) / progressSteps.length) * 100}%` }}
                  />
                </div>

                {/* Steps Checklist */}
                <div className="space-y-3 bg-black/30 border border-white/5 p-4 rounded-none font-mono text-[10px]">
                  {progressSteps.map((s, idx) => {
                    const isDone = currentProgressStep > idx
                    const isCurrent = currentProgressStep === idx
                    return (
                      <div 
                        key={idx} 
                        className={`flex items-center gap-2.5 transition-opacity ${
                          isDone || isCurrent ? 'opacity-100' : 'opacity-25'
                        }`}
                      >
                        {isDone ? (
                          <span className="text-[var(--giga-accent)]">✓</span>
                        ) : isCurrent ? (
                          <span className="text-yellow-400 animate-pulse">▶</span>
                        ) : (
                          <span className="text-white/20">○</span>
                        )}
                        <span className={isCurrent ? 'text-white font-bold' : isDone ? 'text-white/70' : 'text-white/40'}>
                          {s}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="space-y-6 py-4 text-center flex flex-col items-center">
              <div className="flex h-14 w-14 items-center justify-center bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-full animate-bounce">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div>
                <h4 className="font-pixel-header text-sm text-emerald-400 uppercase tracking-widest mb-2">
                  DEPLOYMENT SUCCESSFUL!
                </h4>
                <p className="text-xs text-white/60 leading-relaxed font-pixel-body">
                  Hermes has successfully created the scheduled cron job. The workflow will run automatically at the specified interval.
                </p>
              </div>

              <div className="w-full bg-black/40 border border-white/5 p-4 font-mono text-[10px] text-left space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-white/40">WORKFLOW:</span>
                  <span className="text-white/80 font-bold max-w-[200px] truncate">{workflowTitle}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">CRON EXPRESSION:</span>
                  <span className="text-[var(--giga-accent)]">{selectedCron}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">ORCHESTRATOR:</span>
                  <span className="text-white/80">Hermes v2.0 (Active)</span>
                </div>
              </div>

              <div className="flex w-full gap-3 pt-2">
                <a
                  href="/profile"
                  className="flex-1 bg-white/10 border border-white/10 hover:bg-white/15 px-4 py-2.5 font-pixel-body text-xs text-white text-center transition active:scale-95"
                >
                  VIEW PROFILE
                </a>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 bg-[var(--giga-accent)] px-4 py-2.5 font-pixel-body text-xs text-black font-bold hover:bg-yellow-300 active:scale-95 transition shadow-[2px_2px_0_0_#000]"
                >
                  DONE
                </button>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-6 py-4 text-center flex flex-col items-center">
              <div className="flex h-14 w-14 items-center justify-center bg-red-500/20 text-red-400 border border-red-500/40 rounded-full">
                <span className="text-2xl font-bold">!</span>
              </div>
              <div>
                <h4 className="font-pixel-header text-sm text-red-400 uppercase tracking-widest mb-2">
                  DEPLOYMENT FAILED
                </h4>
                <p className="text-xs text-white/60 leading-relaxed font-pixel-body">
                  An error occurred while deploying the workflow to Hermes:
                </p>
                <div className="mt-3 bg-red-500/10 border border-red-500/20 p-3 font-mono text-[10px] text-red-300">
                  {errorMsg || 'Unknown connection error.'}
                </div>
              </div>

              <div className="flex w-full gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('config')}
                  className="flex-1 border border-white/20 px-4 py-2.5 font-pixel-body text-xs text-white hover:bg-white/5 active:scale-95 transition-all"
                >
                  BACK TO CONFIG
                </button>
                <button
                  type="button"
                  onClick={handleDeploy}
                  className="flex-1 bg-[var(--giga-accent)] px-4 py-2.5 font-pixel-body text-xs text-black font-bold hover:bg-yellow-300 active:scale-95 transition-all shadow-[2px_2px_0_0_#000]"
                >
                  RETRY DEPLOY
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
