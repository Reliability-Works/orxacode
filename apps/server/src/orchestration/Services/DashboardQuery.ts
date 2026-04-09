/**
 * DashboardQuery - Aggregated read model for the dashboard route.
 *
 * Computes project/thread counts, a rolling session chart, and a recent
 * sessions list directly from existing orchestration projection tables.
 * There is no dedicated dashboard projection — the source of truth is the
 * regular thread/project tables maintained by the projection pipeline.
 *
 * @module DashboardQuery
 */
import type { DashboardSnapshot } from '@orxa-code/contracts'
import { ServiceMap } from 'effect'
import type { Effect } from 'effect'

import type { ProjectionRepositoryError } from '../../persistence/Errors.ts'

export interface DashboardQueryShape {
  readonly getSnapshot: () => Effect.Effect<DashboardSnapshot, ProjectionRepositoryError>
}

export class DashboardQuery extends ServiceMap.Service<DashboardQuery, DashboardQueryShape>()(
  'orxacode/orchestration/Services/DashboardQuery'
) {}
