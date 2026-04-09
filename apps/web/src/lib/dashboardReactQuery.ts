import type { ProviderKind } from '@orxa-code/contracts'
import { queryOptions, type QueryClient } from '@tanstack/react-query'

import { getWsRpcClient } from '../wsRpcClient'

const DASHBOARD_STALE_TIME_MS = 5 * 60 * 1000
const PROVIDER_USAGE_STALE_TIME_MS = 5 * 60 * 1000

export const dashboardQueryKeys = {
  all: ['dashboard'] as const,
  snapshot: () => ['dashboard', 'snapshot'] as const,
  providerUsage: (provider: ProviderKind) => ['dashboard', 'providerUsage', provider] as const,
}

export function dashboardSnapshotQueryOptions() {
  return queryOptions({
    queryKey: dashboardQueryKeys.snapshot(),
    queryFn: () => getWsRpcClient().dashboard.getSnapshot(),
    staleTime: DASHBOARD_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })
}

export function providerUsageQueryOptions(provider: ProviderKind) {
  return queryOptions({
    queryKey: dashboardQueryKeys.providerUsage(provider),
    queryFn: () => getWsRpcClient().dashboard.getProviderUsage({ provider }),
    staleTime: PROVIDER_USAGE_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })
}

export function invalidateDashboard(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.all })
}
