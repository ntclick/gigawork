'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { AppRail } from './AppRail'
import { HistorySidebar } from './HistorySidebar'
import { MainHeader } from './MainHeader'

interface Props {
  title: string
  emoji: string
  desc: string
  /** Optional: rough line about what's planned. */
  next?: string
}

export function ComingSoon({ title, emoji, desc, next }: Props) {
  return (
    <div className="giga-theme flex h-full w-full flex-col">
      <MainHeader />
      <div className="flex flex-1 overflow-hidden">
        <HistorySidebar />
        <AppRail />
        <main className="flex-1 overflow-y-auto bg-[#0f131c] p-4 sm:p-8">
          <div className="mx-auto flex w-full max-w-2xl flex-col">
            <div className="mb-6 flex items-center gap-3">
              <Link
                href="/"
                className="inline-flex h-8 w-8 items-center justify-center border-2 border-black bg-[var(--giga-panel)] text-white/70 hover:text-white"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <h1 className="font-pixel-header text-xl text-white sm:text-2xl">{title}</h1>
            </div>

            <div className="border-2 border-black bg-[var(--giga-panel)] px-6 py-12 text-center sm:px-10 sm:py-16">
              <div className="mb-4 text-6xl">{emoji}</div>
              <h2 className="font-pixel-header mb-3 text-2xl text-[var(--giga-accent)]">
                Coming soon
              </h2>
              <p className="mx-auto max-w-md text-sm leading-relaxed text-white/65">
                {desc}
              </p>
              {next && (
                <p className="mx-auto mt-4 max-w-md text-xs text-white/45">
                  <span className="text-white/55">What's next:</span> {next}
                </p>
              )}
              <Link
                href="/"
                className="mt-8 inline-flex items-center gap-1.5 border-2 border-black bg-[var(--giga-accent)] px-5 py-2 text-sm font-bold text-black hover:bg-yellow-300"
              >
                ← Back to Workflows
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
