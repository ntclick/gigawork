'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, FolderClosed, Library, Plus, Settings } from 'lucide-react'

import { useUI } from './UIShell'

/**
 * AppRail — thin (w-24) vertical icon sidebar for the workflow editor.
 * Matches the "GigaWork - Workflow Editor" mockup.
 *
 * Items:
 *  - New Workflow (gold accent button, primary CTA)
 *  - Saved Workflows (opens history drawer)
 *  - Component Library
 *  - Connection Settings
 */

export function AppRail() {
  const pathname = usePathname() ?? '/'
  const { toggleHistory } = useUI()

  return (
    <aside className="giga-theme z-10 hidden w-24 shrink-0 flex-col items-center space-y-7 border-r border-black bg-[var(--giga-sidebar)] py-6 md:flex">
      <Link
        href="/"
        className="group flex flex-col items-center text-center"
        title="New Workflow"
      >
        <div className="pixel-border-sm mb-2 flex h-10 w-10 items-center justify-center bg-[var(--giga-accent)] text-2xl font-bold text-black transition-transform group-hover:scale-105">
          <Plus className="h-5 w-5" strokeWidth={3} />
        </div>
        <span className="font-pixel-body text-[10px] uppercase leading-tight">New<br />Workflow</span>
      </Link>

      <button
        type="button"
        onClick={toggleHistory}
        className="group flex flex-col items-center text-center opacity-70 transition-opacity hover:opacity-100"
        title="Saved Workflows"
      >
        <div className="mb-2 flex h-8 w-8 items-center justify-center text-[var(--giga-text)]">
          <FolderClosed className="h-5 w-5" />
        </div>
        <span className="font-pixel-body text-[10px] uppercase leading-tight">Saved<br />Workflows</span>
      </button>

      <Link
        href="/agents"
        className={[
          'group flex flex-col items-center text-center transition-opacity',
          pathname.startsWith('/agents') ? 'opacity-100' : 'opacity-70 hover:opacity-100',
        ].join(' ')}
        title="Agents (Component Library)"
      >
        <div className="mb-2 flex h-8 w-8 items-center justify-center">
          <Library className="h-5 w-5" />
        </div>
        <span className="font-pixel-body text-[10px] uppercase leading-tight">Component<br />Library</span>
      </Link>

      <Link
        href="/docs"
        className={[
          'group flex flex-col items-center text-center transition-opacity',
          pathname.startsWith('/docs') ? 'opacity-100' : 'opacity-70 hover:opacity-100',
        ].join(' ')}
        title="Docs"
      >
        <div className="mb-2 flex h-8 w-8 items-center justify-center">
          <BookOpen className="h-5 w-5" />
        </div>
        <span className="font-pixel-body text-[10px] uppercase leading-tight">User<br />Docs</span>
      </Link>

      <Link
        href="/settings"
        className={[
          'group flex flex-col items-center text-center transition-opacity',
          pathname.startsWith('/settings') ? 'opacity-100' : 'opacity-70 hover:opacity-100',
        ].join(' ')}
        title="Connection Settings"
      >
        <div className="mb-2 flex h-8 w-8 items-center justify-center">
          <Settings className="h-5 w-5" />
        </div>
        <span className="font-pixel-body text-[10px] uppercase leading-tight">Connection<br />Settings</span>
      </Link>
    </aside>
  )
}
