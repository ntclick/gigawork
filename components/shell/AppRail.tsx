'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, FolderClosed, Library, Plus, Settings, TrendingUp } from 'lucide-react'

import { useUI } from './UIShell'

const RAIL_ITEMS = [
  { icon: Plus, label: 'New', href: '/', isNew: true },
  { icon: FolderClosed, label: 'History', href: null as null, isHistory: true },
  { icon: Library, label: 'Agents', href: '/agents' },
  { icon: TrendingUp, label: 'Signals', href: '/signals' },
  { icon: BookOpen, label: 'Docs', href: '/docs' },
  { icon: Settings, label: 'Settings', href: '/settings' },
]

export function AppRail() {
  const pathname = usePathname() ?? '/'
  const { toggleHistory, historyOpen } = useUI()

  return (
    <aside className="gw-app-rail">
      {RAIL_ITEMS.map((item) => {
        const isActive = item.href
          ? item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href)
          : item.isHistory
          ? historyOpen
          : false
        const Icon = item.icon

        const inner = (
          <div
            className={[
              'relative flex h-9 w-9 items-center justify-center rounded-xl transition',
              item.isNew
                ? 'bg-gradient-to-br from-cyan-400 to-cyan-500 text-black shadow-[0_0_16px_rgba(34,211,238,0.35)] hover:shadow-[0_0_24px_rgba(34,211,238,0.5)]'
                : isActive
                ? 'bg-white/10 text-white'
                : 'text-white/35 hover:bg-white/6 hover:text-white/75',
            ].join(' ')}
            title={item.label}
          >
            <Icon className="h-4 w-4" strokeWidth={item.isNew ? 2.5 : 1.8} />
            {isActive && !item.isNew && (
              <span className="absolute -right-0.5 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-cyan-400" />
            )}
          </div>
        )

        if (item.isHistory) {
          return (
            <button
              key="history"
              type="button"
              onClick={toggleHistory}
              className="flex flex-col items-center"
              aria-label="Workflow History"
            >
              {inner}
            </button>
          )
        }

        return (
          <Link
            key={item.href}
            href={item.href!}
            className="flex flex-col items-center"
            aria-label={item.label}
          >
            {inner}
          </Link>
        )
      })}
    </aside>
  )
}
