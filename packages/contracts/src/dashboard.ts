import { Schema } from 'effect'

import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from './baseSchemas'
import { ProviderKind } from './orchestration.models'

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

/**
 * One bucket in the rolling session chart used by the dashboard.
 * `day` is an ISO-8601 date (`YYYY-MM-DD`) in the server's local timezone.
 */
export const DashboardChartPoint = Schema.Struct({
  day: TrimmedNonEmptyString,
  sessions: NonNegativeInt,
})
export type DashboardChartPoint = typeof DashboardChartPoint.Type

/**
 * Top-N model entry derived from provider session logs. Token and cost fields
 * only exist for provider-usage snapshots; the server-side dashboard snapshot
 * never populates them.
 */
export const ModelUsage = Schema.Struct({
  model: TrimmedNonEmptyString,
  provider: ProviderKind,
  count: NonNegativeInt,
  tokensIn: NonNegativeInt,
  tokensOut: NonNegativeInt,
  costCents: NonNegativeInt,
})
export type ModelUsage = typeof ModelUsage.Type

/**
 * A recent session card shown on the dashboard. Clicking one navigates to the
 * thread route; the `projectName` is denormalized for rendering without a join.
 */
export const RecentSession = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  projectName: Schema.NullOr(TrimmedNonEmptyString),
  provider: ProviderKind,
  updatedAt: IsoDateTime,
})
export type RecentSession = typeof RecentSession.Type

/**
 * Provider-agnostic totals returned by `dashboard.getSnapshot`. Computed on
 * demand from the existing orchestration projections (`projection_projects`,
 * `projection_threads`) — there is no dedicated dashboard projection table.
 *
 * Token and cost data are intentionally excluded because only the desktop
 * shell can scan the per-provider JSONL session logs on disk. The dashboard
 * view composes this snapshot with one `dashboard.getProviderUsage` IPC call
 * per provider.
 */
export const DashboardSnapshot = Schema.Struct({
  updatedAt: IsoDateTime,
  projects: NonNegativeInt,
  threadsTotal: NonNegativeInt,
  threads7d: NonNegativeInt,
  threads30d: NonNegativeInt,
  recentSessions: Schema.Array(RecentSession),
  daySeries: Schema.Array(DashboardChartPoint),
})
export type DashboardSnapshot = typeof DashboardSnapshot.Type

/**
 * Per-provider usage panel data. Sourced from desktop-side filesystem scans
 * (`~/.codex/sessions`, `~/.claude/projects`) rather than the server projection,
 * because those logs live on the user's machine and never hit the server.
 */
export const ProviderUsageSnapshot = Schema.Struct({
  provider: ProviderKind,
  updatedAt: IsoDateTime,
  totalSessions: NonNegativeInt,
  sessions7d: NonNegativeInt,
  sessions30d: NonNegativeInt,
  modelCount: NonNegativeInt,
  tokensIn: NonNegativeInt,
  tokensOut: NonNegativeInt,
  tokensCacheRead: NonNegativeInt,
  estimatedCostCents: NonNegativeInt,
  topModels: Schema.Array(ModelUsage),
})
export type ProviderUsageSnapshot = typeof ProviderUsageSnapshot.Type

// ---------------------------------------------------------------------------
// RPC inputs / results
// ---------------------------------------------------------------------------

export const DashboardGetSnapshotInput = Schema.Struct({})
export type DashboardGetSnapshotInput = typeof DashboardGetSnapshotInput.Type

export const DashboardGetSnapshotResult = DashboardSnapshot
export type DashboardGetSnapshotResult = typeof DashboardGetSnapshotResult.Type

export const DashboardGetProviderUsageInput = Schema.Struct({
  provider: ProviderKind,
})
export type DashboardGetProviderUsageInput = typeof DashboardGetProviderUsageInput.Type

export const DashboardGetProviderUsageResult = ProviderUsageSnapshot
export type DashboardGetProviderUsageResult = typeof DashboardGetProviderUsageResult.Type

export const DashboardRefreshInput = Schema.Struct({})
export type DashboardRefreshInput = typeof DashboardRefreshInput.Type

export const DashboardRefreshResult = DashboardSnapshot
export type DashboardRefreshResult = typeof DashboardRefreshResult.Type

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DashboardQueryError extends Schema.TaggedErrorClass<DashboardQueryError>()(
  'DashboardQueryError',
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }
) {
  override get message(): string {
    return `Dashboard query failed in ${this.operation}: ${this.detail}`
  }
}

export class ProviderUsageUnavailableError extends Schema.TaggedErrorClass<ProviderUsageUnavailableError>()(
  'ProviderUsageUnavailableError',
  {
    provider: ProviderKind,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }
) {
  override get message(): string {
    return `Provider usage snapshot unavailable for ${this.provider}: ${this.detail}`
  }
}
