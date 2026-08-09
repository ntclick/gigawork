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
      {children}
    </div>
  )
}
