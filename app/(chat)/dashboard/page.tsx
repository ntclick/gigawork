import { ComingSoon } from '@/components/shell/ComingSoon'

export default function DashboardPage() {
  return (
    <ComingSoon
      title="Dashboard"
      emoji="📊"
      desc="A unified view of running workflows, credit spend stats, the skills you use most, and your ERC-8004 reputation."
      next="Active workflows · 30-day spend chart · Top agents · Reputation panel"
    />
  )
}
