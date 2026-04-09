/**
 * DashboardQueryLive - Live implementation of {@link DashboardQuery}.
 *
 * Reads directly from `projection_projects` and `projection_threads` and
 * aggregates counts, a session day chart, and a recent-sessions list without
 * maintaining a dedicated dashboard projection.
 *
 * @module DashboardQueryLive
 */
import { Effect, Layer, Schema } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'
import * as SqlSchema from 'effect/unstable/sql/SqlSchema'

import type { DashboardSnapshot, ProviderKind, RecentSession, ThreadId } from '@orxa-code/contracts'

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from '../../persistence/Errors.ts'
import { DashboardQuery, type DashboardQueryShape } from '../Services/DashboardQuery.ts'

const RECENT_SESSIONS_LIMIT = 5
const DAY_SERIES_LENGTH = 7
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000

const CountsRow = Schema.Struct({
  projects: Schema.Number,
  threadsTotal: Schema.Number,
  threads7d: Schema.Number,
  threads30d: Schema.Number,
})

const DaySeriesRow = Schema.Struct({
  day: Schema.String,
  sessions: Schema.Number,
})

const RecentSessionRow = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  projectName: Schema.NullOr(Schema.String),
  provider: Schema.String,
  updatedAt: Schema.String,
})

const isoDayString = (date: Date): string => date.toISOString().slice(0, 10)

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause)
}

function makeCountsQuery(sql: SqlClient.SqlClient) {
  return (input: { readonly sevenDaysAgo: string; readonly thirtyDaysAgo: string }) =>
    SqlSchema.findOne({
      Request: Schema.Struct({
        sevenDaysAgo: Schema.String,
        thirtyDaysAgo: Schema.String,
      }),
      Result: CountsRow,
      execute: ({ sevenDaysAgo, thirtyDaysAgo }) => sql`
        SELECT
          (SELECT COUNT(*) FROM projection_projects WHERE deleted_at IS NULL)
            AS "projects",
          (SELECT COUNT(*) FROM projection_threads WHERE deleted_at IS NULL)
            AS "threadsTotal",
          (
            SELECT COUNT(*) FROM projection_threads
            WHERE deleted_at IS NULL AND created_at >= ${sevenDaysAgo}
          ) AS "threads7d",
          (
            SELECT COUNT(*) FROM projection_threads
            WHERE deleted_at IS NULL AND created_at >= ${thirtyDaysAgo}
          ) AS "threads30d"
      `,
    })(input)
}

function makeDaySeriesQuery(sql: SqlClient.SqlClient) {
  return (input: { readonly sevenDaysAgo: string }) =>
    SqlSchema.findAll({
      Request: Schema.Struct({ sevenDaysAgo: Schema.String }),
      Result: DaySeriesRow,
      execute: ({ sevenDaysAgo }) => sql`
        SELECT
          substr(created_at, 1, 10) AS "day",
          COUNT(*) AS "sessions"
        FROM projection_threads
        WHERE deleted_at IS NULL AND created_at >= ${sevenDaysAgo}
        GROUP BY substr(created_at, 1, 10)
        ORDER BY substr(created_at, 1, 10) ASC
      `,
    })(input)
}

function makeRecentSessionsQuery(sql: SqlClient.SqlClient) {
  return (input: { readonly limit: number }) =>
    SqlSchema.findAll({
      Request: Schema.Struct({ limit: Schema.Number }),
      Result: RecentSessionRow,
      execute: ({ limit }) => sql`
        SELECT
          t.thread_id AS "threadId",
          t.title AS "title",
          p.title AS "projectName",
          COALESCE(
            json_extract(t.model_selection_json, '$.provider'),
            'codex'
          ) AS "provider",
          t.updated_at AS "updatedAt"
        FROM projection_threads AS t
        LEFT JOIN projection_projects AS p
          ON p.project_id = t.project_id AND p.deleted_at IS NULL
        WHERE t.deleted_at IS NULL
        ORDER BY t.updated_at DESC
        LIMIT ${limit}
      `,
    })(input)
}

function fillDaySeries(
  rows: ReadonlyArray<{ readonly day: string; readonly sessions: number }>,
  now: Date
): DashboardSnapshot['daySeries'] {
  const byDay = new Map(rows.map(row => [row.day, row.sessions] as const))
  const result: Array<{ day: string; sessions: number }> = []
  for (let offset = DAY_SERIES_LENGTH - 1; offset >= 0; offset -= 1) {
    const day = isoDayString(new Date(now.getTime() - offset * MS_PER_DAY))
    result.push({ day, sessions: byDay.get(day) ?? 0 })
  }
  return result
}

const KNOWN_PROVIDERS: ReadonlySet<ProviderKind> = new Set<ProviderKind>([
  'codex',
  'claudeAgent',
  'opencode',
])

function coerceProvider(raw: string): ProviderKind {
  return (KNOWN_PROVIDERS as Set<string>).has(raw) ? (raw as ProviderKind) : 'codex'
}

function toRecentSession(row: typeof RecentSessionRow.Type): RecentSession {
  return {
    threadId: row.threadId as ThreadId,
    title: row.title.length > 0 ? row.title : 'Untitled session',
    projectName: row.projectName && row.projectName.length > 0 ? row.projectName : null,
    provider: coerceProvider(row.provider),
    updatedAt: row.updatedAt,
  }
}

const makeDashboardQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const countsQuery = makeCountsQuery(sql)
  const daySeriesQuery = makeDaySeriesQuery(sql)
  const recentSessionsQuery = makeRecentSessionsQuery(sql)

  const getSnapshot: DashboardQueryShape['getSnapshot'] = () =>
    Effect.gen(function* () {
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString()
      const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString()

      const counts = yield* countsQuery({ sevenDaysAgo, thirtyDaysAgo }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            'DashboardQuery.getSnapshot:counts:query',
            'DashboardQuery.getSnapshot:counts:decodeRow'
          )
        )
      )

      const daySeriesRows = yield* daySeriesQuery({ sevenDaysAgo }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            'DashboardQuery.getSnapshot:daySeries:query',
            'DashboardQuery.getSnapshot:daySeries:decodeRows'
          )
        )
      )

      const recentRows = yield* recentSessionsQuery({ limit: RECENT_SESSIONS_LIMIT }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            'DashboardQuery.getSnapshot:recentSessions:query',
            'DashboardQuery.getSnapshot:recentSessions:decodeRows'
          )
        )
      )

      return {
        updatedAt: now.toISOString(),
        projects: counts.projects,
        threadsTotal: counts.threadsTotal,
        threads7d: counts.threads7d,
        threads30d: counts.threads30d,
        recentSessions: recentRows.map(toRecentSession),
        daySeries: fillDaySeries(daySeriesRows, now),
      } satisfies DashboardSnapshot
    })

  return { getSnapshot } satisfies DashboardQueryShape
})

export const DashboardQueryLive = Layer.effect(DashboardQuery, makeDashboardQuery)
