import type { DashboardSnapshot } from '@orxa-code/contracts'

import { Card, CardPanel, CardHeader, CardTitle, CardDescription } from '../ui/card'
import { cn } from '~/lib/utils'

interface MetricCardProps {
  label: string
  value: number | string
  sub?: string
  className?: string
}

function MetricCard({ label, value, sub, className }: MetricCardProps) {
  return (
    <Card className={cn('gap-0', className)}>
      <CardHeader className="pb-1">
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {sub ? (
        <CardPanel className="pt-0 pb-4">
          <span className="text-xs text-muted-foreground">{sub}</span>
        </CardPanel>
      ) : null}
    </Card>
  )
}

interface DashboardMetricGridProps {
  snapshot: DashboardSnapshot
}

export function DashboardMetricGrid({ snapshot }: DashboardMetricGridProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="Projects" value={snapshot.projects} />
      <MetricCard label="Total sessions" value={snapshot.threadsTotal} />
      <MetricCard
        label="Sessions (last 7 days)"
        value={snapshot.threads7d}
        sub={`${snapshot.threads30d} in the last 30 days`}
      />
      <MetricCard
        label="Sessions (last 30 days)"
        value={snapshot.threads30d}
        sub={`${snapshot.threads7d} this week`}
      />
    </div>
  )
}
