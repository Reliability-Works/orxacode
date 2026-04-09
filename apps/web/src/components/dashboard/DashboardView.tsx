import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCwIcon } from 'lucide-react'

import { SidebarInset } from '../ui/sidebar'
import { useSidebar } from '../ui/sidebar.shared'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { APP_TOP_LEFT_BAR_WIDTH } from '../AppTopLeftBar'
import { isElectron } from '../../env'
import {
  dashboardSnapshotQueryOptions,
  invalidateDashboard,
  providerUsageQueryOptions,
} from '../../lib/dashboardReactQuery'
import { cn } from '~/lib/utils'
import { DashboardMetricGrid } from './DashboardMetricGrid'
import { DashboardSessionChart } from './DashboardSessionChart'
import { DashboardRecentSessions } from './DashboardRecentSessions'
import { DashboardProviderPanel } from './DashboardProviderPanel'

function DashboardHeader({
  collapsed,
  onRefresh,
  refreshing,
}: {
  collapsed: boolean
  onRefresh: () => void
  refreshing: boolean
}) {
  return (
    <div
      className={cn(
        'flex h-[52px] shrink-0 items-center border-b border-border px-5',
        isElectron && 'drag-region'
      )}
      style={collapsed ? { paddingInlineStart: APP_TOP_LEFT_BAR_WIDTH } : undefined}
    >
      <span className="text-xs font-medium tracking-wide text-muted-foreground/70">Dashboard</span>
      <div className="ms-auto">
        <Button
          size="xs"
          variant="ghost"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh dashboard"
        >
          <RefreshCwIcon className={cn('size-3.5', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-28 rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

export function DashboardView() {
  const { state } = useSidebar()
  const collapsed = state === 'collapsed'
  const queryClient = useQueryClient()
  const snapshotQuery = useQuery(dashboardSnapshotQueryOptions())
  const codexQuery = useQuery(providerUsageQueryOptions('codex'))
  const claudeQuery = useQuery(providerUsageQueryOptions('claudeAgent'))

  const refreshing = snapshotQuery.isFetching || codexQuery.isFetching || claudeQuery.isFetching
  const onRefresh = () => void invalidateDashboard(queryClient)

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <DashboardHeader collapsed={collapsed} onRefresh={onRefresh} refreshing={refreshing} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {snapshotQuery.isPending ? (
            <DashboardSkeleton />
          ) : snapshotQuery.isError ? (
            <div className="flex items-center justify-center p-10">
              <p className="text-sm text-muted-foreground">Failed to load dashboard.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6 p-5">
              <DashboardMetricGrid snapshot={snapshotQuery.data} />
              <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
                <DashboardSessionChart daySeries={snapshotQuery.data.daySeries} />
                <DashboardRecentSessions recentSessions={snapshotQuery.data.recentSessions} />
              </div>
              <div>
                <p className="mb-3 text-xs font-medium text-muted-foreground">Provider usage</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <DashboardProviderPanel provider="codex" query={codexQuery} />
                  <DashboardProviderPanel provider="claudeAgent" query={claudeQuery} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </SidebarInset>
  )
}
