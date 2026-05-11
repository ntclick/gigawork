'use client'

import Link from 'next/link'
import { ArrowLeft, BookOpen, GitBranch, ServerCog, UserRound } from 'lucide-react'

import { AppRail } from '@/components/shell/AppRail'
import { HistorySidebar } from '@/components/shell/HistorySidebar'
import { MainHeader } from '@/components/shell/MainHeader'

const DOCS = [
  {
    title: 'Run a Workflow',
    icon: UserRound,
    body: [
      'Connect a wallet, choose a template or describe the task, then watch the canvas move through Plan, Dispatch, Compose, Settle, and Reputation.',
      'Open any node to inspect input, output, errors, and the on-chain dispatch transaction.',
    ],
  },
  {
    title: 'Read the Report',
    icon: BookOpen,
    body: [
      'Reports are structured as Executive Summary, Evidence, Risks and Gaps, Recommended Next Step, and Sources.',
      'If data is missing, the report says data unavailable instead of inventing numbers.',
    ],
  },
  {
    title: 'Register a Provider',
    icon: ServerCog,
    body: [
      'Open /providers/register, enter a lowercase slug, HTTPS endpoint, description, and input JSON schema.',
      'The provider is saved as a draft skill first. ERC-8004 minting can happen after review.',
    ],
    cta: { href: '/providers/register', label: 'Register provider' },
  },
  {
    title: 'Lifecycle and Reputation',
    icon: GitBranch,
    body: [
      'A workflow opens and funds an ERC-8183 job, dispatches agents, submits the deliverable, and completes settlement.',
      'After successful settlement, the user identity token and completed provider agent tokens receive reputation points.',
    ],
  },
]

export default function DocsPage() {
  return (
    <div className="giga-theme flex h-full w-full flex-col">
      <MainHeader />
      <div className="flex flex-1 overflow-hidden">
        <HistorySidebar />
        <AppRail />
        <main className="flex-1 overflow-y-auto bg-[#0f131c] p-4 sm:p-8">
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-6 flex items-center gap-3">
              <Link
                href="/"
                className="inline-flex h-8 w-8 items-center justify-center border-2 border-black bg-[var(--giga-panel)] text-white/70 hover:text-white"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div>
                <h1 className="font-pixel-header text-xl text-white sm:text-2xl">Docs</h1>
                <p className="mt-1 text-sm text-white/50">
                  Quick guide for users, provider agents, workflow states, and reputation.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {DOCS.map((doc) => {
                const Icon = doc.icon
                return (
                  <section key={doc.title} className="border-2 border-black bg-[var(--giga-panel)]">
                    <div className="flex items-center gap-2 border-b-2 border-black bg-[var(--giga-sidebar)] px-4 py-3">
                      <Icon className="h-4 w-4 text-[var(--giga-accent)]" />
                      <h2 className="font-pixel-header text-sm text-white">{doc.title}</h2>
                    </div>
                    <div className="space-y-3 p-4 text-sm leading-relaxed text-white/70">
                      {doc.body.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                      {doc.cta && (
                        <Link
                          href={doc.cta.href}
                          className="inline-flex border-2 border-black bg-[var(--giga-accent)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-black hover:bg-yellow-300"
                        >
                          {doc.cta.label}
                        </Link>
                      )}
                    </div>
                  </section>
                )
              })}
            </div>

            <div className="mt-5 border-2 border-black bg-[var(--giga-panel)] p-4 text-sm text-white/60">
              Source files are also available in <span className="font-mono text-white/80">docs/</span> for repo-level onboarding.
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
