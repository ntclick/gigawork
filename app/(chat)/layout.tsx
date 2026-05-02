import { UIShell } from '@/components/shell/UIShell'

/**
 * (chat) layout — minimal wrapper. Each page (home, workflow editor) renders
 * its own structural shell because the home page uses HistorySidebar while
 * the editor uses MainHeader + AppRail + DocPanel — different paradigms.
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <UIShell>
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#0f131c] text-white/90">
        {children}
      </div>
    </UIShell>
  )
}
