/**
 * WS handlers for `dashboard.*` RPCs.
 *
 * Extracted from `ws.ts` to keep the aggregator file under the 500-line lint
 * cap. Both the snapshot and provider-usage handlers are defined together
 * because they share the `DashboardGetProviderUsageInput` payload type and
 * the same error-mapping philosophy (contracts own the error shape, we just
 * reshape server-internal failures into it).
 *
 * @module ws.dashboard
 */
import {
  type DashboardGetProviderUsageInput,
  DashboardQueryError,
  ProviderUsageUnavailableError,
  WS_METHODS,
} from '@orxa-code/contracts'
import { Effect } from 'effect'

import type { DashboardQuery } from './orchestration/Services/DashboardQuery'
import type { ProviderUsageQuery } from './orchestration/Services/ProviderUsageQuery'

export interface DashboardMethodDependencies {
  readonly dashboardQuery: typeof DashboardQuery.Service
  readonly providerUsageQuery: typeof ProviderUsageQuery.Service
}

export const createDashboardMethods = ({
  dashboardQuery,
  providerUsageQuery,
}: DashboardMethodDependencies) => {
  const loadSnapshot = () =>
    dashboardQuery.getSnapshot().pipe(
      Effect.mapError(
        cause =>
          new DashboardQueryError({
            operation: 'dashboard.getSnapshot',
            detail: 'Failed to compute dashboard snapshot',
            cause,
          })
      )
    )
  const loadProviderUsage = (input: DashboardGetProviderUsageInput) =>
    providerUsageQuery.getSnapshot(input).pipe(
      Effect.catchDefect((cause: unknown) =>
        Effect.fail(
          new ProviderUsageUnavailableError({
            provider: input.provider,
            detail: 'Failed to read provider usage logs',
            cause,
          })
        )
      )
    )
  return {
    [WS_METHODS.dashboardGetSnapshot]: loadSnapshot,
    [WS_METHODS.dashboardRefresh]: loadSnapshot,
    [WS_METHODS.dashboardGetProviderUsage]: loadProviderUsage,
  }
}
