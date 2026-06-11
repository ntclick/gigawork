'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MainHeader } from '@/components/shell/MainHeader'
import { Step1Info } from '@/components/raffle/CreateForm/Step1Info'
import { Step2List } from '@/components/raffle/CreateForm/Step2List'
import { Step3Confirm } from '@/components/raffle/CreateForm/Step3Confirm'
import { Orbit, Sparkles } from 'lucide-react'

export default function CreateRafflePage() {
  const [currentStep, setCurrentStep] = useState(1)

  // Step 1 state
  const [infoData, setInfoData] = useState({
    title: '',
    description: '',
    prizeDescription: '',
    winnerCount: 1,
  })

  // Step 2 state
  const [listData, setListData] = useState({
    rawInput: '',
    entries: [] as string[],
    merkleRoot: '',
    commitBlock: 0,
    totalEntries: 0,
  })

  const handleStep1Next = (updatedData: Partial<typeof infoData>) => {
    setInfoData((prev) => ({ ...prev, ...updatedData }))
    setCurrentStep(2)
  }

  const handleStep2Next = (updatedData: typeof listData) => {
    setListData(updatedData)
    setCurrentStep(3)
  }

  const handlePrevStep = () => {
    setCurrentStep((prev) => Math.max(1, prev - 1))
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0a0d14] text-white">
      <MainHeader />

      <div className="flex-1 overflow-y-auto py-10 px-6 scrollbar-thin">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-white/5">
            <div className="space-y-1">
              <h1 className="text-2xl font-extrabold uppercase tracking-wide text-slate-100 font-pixel-body flex items-center gap-2">
                <Orbit className="h-6 w-6 text-cyan-400 animate-spin" style={{ animationDuration: '8s' }} />
                Raffle Setup
              </h1>
              <p className="text-xs text-slate-500">
                Create a public, cryptographically verifiable raffle system in 3 simple steps.
              </p>
            </div>
            
            <Link
              href="/raffle"
              className="text-xs text-slate-400 hover:text-cyan-400 transition-colors uppercase tracking-wider font-semibold"
            >
              Cancel &amp; Back
            </Link>
          </div>

          {/* Step Progress Tracker */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { num: 1, label: 'Information' },
              { num: 2, label: 'Contestants' },
              { num: 3, label: 'Deployment' },
            ].map((step) => {
              const active = currentStep === step.num
              const done = currentStep > step.num

              return (
                <div
                  key={step.num}
                  className={`flex flex-col gap-1.5 p-3.5 rounded-xl border transition-all duration-300 ${
                    active
                      ? 'border-cyan-500/30 bg-cyan-950/15 shadow-[0_0_15px_rgba(6,182,212,0.05)]'
                      : done
                      ? 'border-emerald-500/20 bg-emerald-950/5'
                      : 'border-white/5 bg-slate-950/40 opacity-55'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`h-5 w-5 rounded-full text-[10px] font-bold flex items-center justify-center border font-mono ${
                        active
                          ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.4)] animate-pulse'
                          : done
                          ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                          : 'bg-slate-900 text-slate-500 border-slate-800'
                      }`}
                    >
                      {step.num}
                    </span>
                    {active && <Sparkles className="h-3.5 w-3.5 text-cyan-400 animate-bounce" />}
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      active ? 'text-cyan-400 font-extrabold' : done ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Wizard Card Body */}
          <div className="border border-white/10 bg-slate-950/60 p-6 md:p-8 rounded-2xl backdrop-blur-md relative overflow-hidden shadow-xl">
            <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/25 to-transparent" />
            
            {currentStep === 1 && (
              <Step1Info data={infoData} onNext={handleStep1Next} />
            )}
            {currentStep === 2 && (
              <Step2List
                winnerCount={infoData.winnerCount}
                data={listData}
                onPrev={handlePrevStep}
                onNext={handleStep2Next}
              />
            )}
            {currentStep === 3 && (
              <Step3Confirm
                infoData={infoData}
                listData={listData}
                onPrev={handlePrevStep}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
