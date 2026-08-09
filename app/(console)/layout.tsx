import { Footer } from '@/components/console/Footer'
import { Header } from '@/components/console/Header'
import { SessionSync } from '@/components/console/SessionSync'

/**
 * Shell: a persistent top nav + the surface below it.
 *
 * SessionSync is headless and must live here (not per page) — it keeps the
 * server auth cookie pointed at the signing wallet, and every API route
 * 401s without it.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="gwt-screen">
      <SessionSync />
      <Header />
      {/* The footer scrolls with the page rather than being pinned under
          it. Pinned, it would permanently eat ~200px of every surface —
          worst on a running workflow, where the terminal is meant to stay
          compact and visible. Scrolling moves the page's overflow from
          .gwt-page up to this wrapper. */}
      <div className="gwt-body">
        {children}
        <Footer />
      </div>
    </div>
  )
}
