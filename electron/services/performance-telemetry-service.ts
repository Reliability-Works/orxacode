import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type {
  PerfAlert,
  PerfEventEntry,
  PerfEventInput,
  PerfKind,
  PerfMetric,
  PerfOutcome,
  PerfSizeBucket,
  PerfSnapshotExport,
  PerfSnapshotExportInput,
  PerfSummaryFilter,
  PerfSummaryRow,
  PerfSurface,
  PerfTrigger,
} from '../../shared/ipc'
import {
  PERF_KINDS,
  PERF_METRICS,
  PERF_OUTCOMES,
  PERF_SIZE_BUCKETS,
  PERF_SURFACES,
  PERF_TRIGGERS,
  PERF_UNITS,
} from '../../shared/ipc'
import { getPersistenceDatabasePath } from './persistence-service'

const PERF_MAX_ROWS = 50_000
const PERF_RETENTION_MS = 1000 * 60 * 60 * 24 * 7
const PERF_ALERT_COOLDOWN_MS = 60_000
const PERF_META_SALT_KEY = 'salt'
const PERF_DEFAULT_SUMMARY_LIMIT = 5_000
const PERF_DEFAULT_EVENT_LIMIT = 5_000
const PERF_DEFAULT_MIN_DURATION_MS = 120
const PERF_INTERNAL_TELEMETRY_CHANNELS = [
  'orxa:app:reportPerf',
  'orxa:app:listPerfSummary',
  'orxa:app:exportPerfSnapshot',
] as const
const PERF_PRIORITY_METRICS = new Set<PerfMetric>([
  'workspace.refresh_ms',
  'background.workspace_refresh_ms',
  'session.runtime.load_ms',
  'session.messages.load_ms',
  'prompt.send_ack_ms',
  'prompt.first_event_ms',
  'prompt.first_assistant_output_ms',
  'prompt.complete_ms',
  'ipc.invoke_rtt_ms',
  'ipc.handler_ms',
  'ipc.inflight_count',
  'renderer.longtask_ms',
  'opencode.send_prompt_ms',
  'opencode.get_session_runtime_ms',
  'opencode.load_messages_ms',
  'codex.start_turn_ms',
])
const PERF_PRIORITY_CHANNELS = new Set<string>([
  'orxa:opencode:sendPrompt',
  'orxa:opencode:getSessionRuntime',
  'orxa:opencode:loadMessages',
  'orxa:opencode:refreshProject',
  'orxa:claude-chat:startTurn',
  'orxa:claude-chat:getState',
  'orxa:claude-chat:getSessionMessages',
  'orxa:codex:startTurn',
  'orxa:codex:resumeThread',
  'orxa:codex:resumeProviderThread',
])

type SqliteDatabase = {
  exec(sql: string): unknown
  prepare(sql: string): {
    get(...params: unknown[]): unknown
    run(...params: unknown[]): unknown
    all(...params: unknown[]): unknown
  }
}

type PerfEventRow = {
  id?: string
  timestamp?: number
  surface?: string
  metric?: string
  kind?: string
  value?: number
  unit?: string
  outcome?: string | null
  trigger?: string | null
  process?: string
  channel?: string | null
  component?: string | null
  workspace_hash?: string | null
  session_hash?: string | null
  thread_hash?: string | null
  request_size_bucket?: string | null
  response_size_bucket?: string | null
  sample_rate?: number | null
}

const require = createRequire(import.meta.url)

function createDatabase(databasePath: string): SqliteDatabase {
  try {
    const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3')
    return new BetterSqlite3(databasePath)
  } catch (error) {
    if (process.versions.electron) {
      throw error
    }
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    return new DatabaseSync(databasePath)
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function asTrimmedString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return undefined
  }
  return trimmed
}

function asAllowedEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T
): T[number] | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined
}

function quantile(sorted: number[], p: number) {
  if (sorted.length === 0) {
    return undefined
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[index]
}

function normalizeLimit(value: unknown, fallback: number) {
  if (!isFiniteNumber(value)) {
    return fallback
  }
  return Math.max(1, Math.min(100_000, Math.floor(value)))
}

function normalizeMinDuration(value: unknown) {
  if (!isFiniteNumber(value)) {
    return PERF_DEFAULT_MIN_DURATION_MS
  }
  return Math.max(1, Math.min(60_000, Math.floor(value)))
}

function normalizeSurfaceAllowlist(values?: PerfSurface[]) {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined
  }
  const normalized = values
    .map(value => asAllowedEnum(value, PERF_SURFACES))
    .filter((value): value is PerfSurface => Boolean(value))
  return normalized.length > 0 ? [...new Set(normalized)] : undefined
}

function matchesSurface(surface: PerfSurface, allowlist?: PerfSurface[]) {
  return !allowlist || allowlist.length === 0 || allowlist.includes(surface)
}

function isSlowTimingEvent(event: PerfEventEntry, minDurationMs: number) {
  if (event.metric === 'ipc.inflight_count') {
    return event.value >= 2
  }
  return event.unit === 'ms' && event.value >= minDurationMs
}

function shouldIncludeExportEvent(
  event: PerfEventEntry,
  options: { slowOnly: boolean; minDurationMs: number; surfaces?: PerfSurface[] }
) {
  if (!matchesSurface(event.surface, options.surfaces)) {
    return false
  }
  if (!options.slowOnly) {
    return true
  }
  if (event.outcome === 'error' || event.outcome === 'timeout') {
    return true
  }
  return isSlowTimingEvent(event, options.minDurationMs)
}

function shouldIncludeExportSummary(
  row: PerfSummaryRow,
  options: { slowOnly: boolean; minDurationMs: number; surfaces?: PerfSurface[] }
) {
  if (!matchesSurface(row.surface, options.surfaces)) {
    return false
  }
  if (!options.slowOnly) {
    return true
  }
  if (row.errorCount > 0) {
    return true
  }
  if (row.metric === 'ipc.inflight_count') {
    return (row.p95 ?? row.max ?? 0) >= 2
  }
  if (row.metric.endsWith('_ms')) {
    return (row.p95 ?? 0) >= options.minDurationMs || (row.max ?? 0) >= options.minDurationMs
  }
  return false
}

function isPriorityEvent(event: PerfEventEntry, minDurationMs: number) {
  if (event.outcome === 'error' || event.outcome === 'timeout') {
    return true
  }
  if (event.metric === 'renderer.longtask_ms' && event.value >= minDurationMs) {
    return true
  }
  if (!isSlowTimingEvent(event, minDurationMs)) {
    return false
  }
  return (
    PERF_PRIORITY_METRICS.has(event.metric) ||
    (!!event.channel && PERF_PRIORITY_CHANNELS.has(event.channel))
  )
}

function selectPrioritizedEvents(events: PerfEventEntry[], limit: number, minDurationMs: number) {
  const prioritized: PerfEventEntry[] = []
  const regular: PerfEventEntry[] = []
  for (const event of events) {
    if (isPriorityEvent(event, minDurationMs)) {
      prioritized.push(event)
    } else {
      regular.push(event)
    }
  }
  const selected = [...prioritized, ...regular].slice(0, limit)
  return {
    selected,
    priorityMatched: prioritized.length,
    priorityExported: selected.reduce(
      (count, event) => count + (isPriorityEvent(event, minDurationMs) ? 1 : 0),
      0
    ),
  }
}

function sanitizeChannel(value: unknown) {
  const trimmed = asTrimmedString(value, 96)
  if (!trimmed) {
    return undefined
  }
  return /^orxa:[a-z0-9:_-]+$/i.test(trimmed) ? trimmed : undefined
}

function sanitizeComponent(value: unknown) {
  const trimmed = asTrimmedString(value, 64)
  if (!trimmed) {
    return undefined
  }
  return /^[a-z0-9._:-]+$/i.test(trimmed) ? trimmed : undefined
}

export class PerformanceTelemetryService {
  private readonly database: SqliteDatabase
  private salt = ''
  private lastAlertByMetric = new Map<PerfMetric, number>()

  constructor(databasePath?: string) {
    const resolvedPath = databasePath ?? getPersistenceDatabasePath()
    mkdirSync(path.dirname(resolvedPath), { recursive: true })
    this.database = createDatabase(resolvedPath)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS perf_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS perf_events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        surface TEXT NOT NULL,
        metric TEXT NOT NULL,
        kind TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        outcome TEXT,
        trigger TEXT,
        process TEXT NOT NULL,
        channel TEXT,
        component TEXT,
        workspace_hash TEXT,
        session_hash TEXT,
        thread_hash TEXT,
        request_size_bucket TEXT,
        response_size_bucket TEXT,
        sample_rate REAL
      );
      CREATE INDEX IF NOT EXISTS idx_perf_events_metric_ts
        ON perf_events(metric, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_perf_events_surface_ts
        ON perf_events(surface, timestamp DESC);
    `)
    this.ensureSalt()
  }

  private ensureSalt() {
    const existing = this.database
      .prepare('SELECT value FROM perf_meta WHERE key = ?')
      .get(PERF_META_SALT_KEY) as { value?: string } | undefined
    if (typeof existing?.value === 'string' && existing.value.length > 0) {
      this.salt = existing.value
      return
    }
    this.salt = randomBytes(16).toString('hex')
    this.database
      .prepare(
        `
          INSERT INTO perf_meta (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
      )
      .run(PERF_META_SALT_KEY, this.salt)
  }

  private hashIdentifier(value: string | undefined) {
    if (!value) {
      return undefined
    }
    return createHash('sha256')
      .update(this.salt)
      .update('\0')
      .update(value)
      .digest('hex')
      .slice(0, 16)
  }

  private sanitizeInput(input: PerfEventInput): PerfEventInput | null {
    const surface = asAllowedEnum(input.surface, PERF_SURFACES)
    const metric = asAllowedEnum(input.metric, PERF_METRICS)
    const kind = asAllowedEnum(input.kind, PERF_KINDS)
    const unit = asAllowedEnum(input.unit, PERF_UNITS)
    const process =
      input.process === 'renderer' || input.process === 'main' ? input.process : undefined
    if (
      !surface ||
      !metric ||
      !kind ||
      !unit ||
      !process ||
      !isFiniteNumber(input.value) ||
      input.value < 0
    ) {
      return null
    }

    const outcome = asAllowedEnum(input.outcome, PERF_OUTCOMES) as PerfOutcome | undefined
    const trigger = asAllowedEnum(input.trigger, PERF_TRIGGERS) as PerfTrigger | undefined
    const requestSizeBucket = asAllowedEnum(input.requestSizeBucket, PERF_SIZE_BUCKETS) as
      | PerfSizeBucket
      | undefined
    const responseSizeBucket = asAllowedEnum(input.responseSizeBucket, PERF_SIZE_BUCKETS) as
      | PerfSizeBucket
      | undefined

    return {
      surface: surface as PerfSurface,
      metric: metric as PerfMetric,
      kind: kind as PerfKind,
      value: Math.round(input.value * 100) / 100,
      unit,
      outcome,
      trigger,
      process,
      channel: sanitizeChannel(input.channel),
      component: sanitizeComponent(input.component),
      workspaceHash: this.hashIdentifier(asTrimmedString(input.workspaceHash, 512)),
      sessionHash: this.hashIdentifier(asTrimmedString(input.sessionHash, 512)),
      threadHash: this.hashIdentifier(asTrimmedString(input.threadHash, 512)),
      requestSizeBucket,
      responseSizeBucket,
      sampleRate:
        isFiniteNumber(input.sampleRate) && input.sampleRate > 0 && input.sampleRate <= 1
          ? Math.round(input.sampleRate * 1000) / 1000
          : undefined,
    }
  }

  private prune(now: number) {
    this.database
      .prepare('DELETE FROM perf_events WHERE timestamp < ?')
      .run(now - PERF_RETENTION_MS)
    const countRow = this.database.prepare('SELECT COUNT(*) as count FROM perf_events').get() as
      | { count?: number }
      | undefined
    const count = typeof countRow?.count === 'number' ? countRow.count : 0
    if (count <= PERF_MAX_ROWS) {
      return
    }
    const overflow = count - PERF_MAX_ROWS
    this.database
      .prepare(
        `
        DELETE FROM perf_events
        WHERE id IN (
          SELECT id FROM perf_events
          ORDER BY timestamp ASC
          LIMIT ?
        )
      `
      )
      .run(overflow)
  }

  private buildAlert(entry: PerfEventEntry): PerfAlert | null {
    const prior = this.lastAlertByMetric.get(entry.metric) ?? 0
    if (entry.timestamp - prior < PERF_ALERT_COOLDOWN_MS) {
      return null
    }

    let alert: PerfAlert | null = null
    if (entry.metric === 'workspace.refresh_ms' && entry.value >= 2_000) {
      alert = {
        metric: entry.metric,
        surface: entry.surface,
        severity: 'warn',
        summary: 'slow workspace refresh',
        timestamp: entry.timestamp,
      }
    } else if (entry.metric === 'render.commit_ms' && entry.value >= 120) {
      alert = {
        metric: entry.metric,
        surface: entry.surface,
        severity: 'warn',
        summary: 'render pressure high',
        timestamp: entry.timestamp,
      }
    } else if (
      (entry.metric === 'ipc.invoke_rtt_ms' || entry.metric === 'ipc.handler_ms') &&
      entry.value >= 500
    ) {
      alert = {
        metric: entry.metric,
        surface: entry.surface,
        severity: 'warn',
        summary: 'ipc p95 spike',
        timestamp: entry.timestamp,
      }
    } else if (entry.metric === 'renderer.longtask_ms' && entry.value >= 250) {
      alert = {
        metric: entry.metric,
        surface: entry.surface,
        severity: 'warn',
        summary: 'renderer long task spike',
        timestamp: entry.timestamp,
      }
    }

    if (alert) {
      this.lastAlertByMetric.set(entry.metric, entry.timestamp)
    }
    return alert
  }

  record(input: PerfEventInput): { entry: PerfEventEntry; alert: PerfAlert | null } | null {
    const sanitized = this.sanitizeInput(input)
    if (!sanitized) {
      return null
    }
    const entry: PerfEventEntry = {
      id: `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`,
      timestamp: Date.now(),
      ...sanitized,
    }
    this.database
      .prepare(
        `
          INSERT INTO perf_events (
            id, timestamp, surface, metric, kind, value, unit, outcome, trigger, process,
            channel, component, workspace_hash, session_hash, thread_hash,
            request_size_bucket, response_size_bucket, sample_rate
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        entry.id,
        entry.timestamp,
        entry.surface,
        entry.metric,
        entry.kind,
        entry.value,
        entry.unit,
        entry.outcome ?? null,
        entry.trigger ?? null,
        entry.process,
        entry.channel ?? null,
        entry.component ?? null,
        entry.workspaceHash ?? null,
        entry.sessionHash ?? null,
        entry.threadHash ?? null,
        entry.requestSizeBucket ?? null,
        entry.responseSizeBucket ?? null,
        entry.sampleRate ?? null
      )
    this.prune(entry.timestamp)
    const alert = this.buildAlert(entry)
    return { entry, alert }
  }

  private buildEventWhereClause(filter: {
    sinceMs?: number
    includeInternalTelemetry: boolean
    surfaces?: PerfSurface[]
  }): {
    where: string
    params: unknown[]
  } {
    const predicates: string[] = []
    const params: unknown[] = []
    if (isFiniteNumber(filter.sinceMs) && filter.sinceMs > 0) {
      predicates.push('timestamp >= ?')
      params.push(Date.now() - filter.sinceMs)
    }
    if (!filter.includeInternalTelemetry) {
      predicates.push(
        `(channel IS NULL OR channel NOT IN (${PERF_INTERNAL_TELEMETRY_CHANNELS.map(() => '?').join(', ')}))`
      )
      params.push(...PERF_INTERNAL_TELEMETRY_CHANNELS)
    }
    if (filter.surfaces && filter.surfaces.length > 0) {
      predicates.push(`surface IN (${filter.surfaces.map(() => '?').join(', ')})`)
      params.push(...filter.surfaces)
    }
    return {
      where: predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '',
      params,
    }
  }

  private countEvents(filter: {
    sinceMs?: number
    includeInternalTelemetry: boolean
    surfaces?: PerfSurface[]
  }) {
    const { where, params } = this.buildEventWhereClause(filter)
    const countRow = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM perf_events
          ${where}
        `
      )
      .get(...params) as { count?: number } | undefined
    return typeof countRow?.count === 'number' ? countRow.count : 0
  }

  listSummary(filter: PerfSummaryFilter = {}): PerfSummaryRow[] {
    const predicates: string[] = []
    const params: unknown[] = []

    const surface = asAllowedEnum(filter.surface, PERF_SURFACES)
    const metric = asAllowedEnum(filter.metric, PERF_METRICS)
    const process =
      filter.process === 'renderer' || filter.process === 'main' ? filter.process : undefined
    const includeInternalTelemetry = filter.includeInternalTelemetry !== false

    if (surface) {
      predicates.push('surface = ?')
      params.push(surface)
    }
    if (metric) {
      predicates.push('metric = ?')
      params.push(metric)
    }
    if (process) {
      predicates.push('process = ?')
      params.push(process)
    }
    if (isFiniteNumber(filter.sinceMs) && filter.sinceMs > 0) {
      predicates.push('timestamp >= ?')
      params.push(Date.now() - filter.sinceMs)
    }
    if (!includeInternalTelemetry) {
      predicates.push(
        `(channel IS NULL OR channel NOT IN (${PERF_INTERNAL_TELEMETRY_CHANNELS.map(() => '?').join(', ')}))`
      )
      params.push(...PERF_INTERNAL_TELEMETRY_CHANNELS)
    }

    const where = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''
    const rows = this.database
      .prepare(
        `
          SELECT metric, surface, value, outcome, channel, component
          FROM perf_events
          ${where}
          ORDER BY timestamp DESC
        `
      )
      .all(...params) as Array<{
      metric?: string
      surface?: string
      value?: number
      outcome?: string | null
    }>

    const grouped = new Map<
      string,
      {
        metric: PerfMetric
        surface: PerfSurface
        channel?: string
        component?: string
        values: number[]
        errorCount: number
      }
    >()
    for (const row of rows) {
      const rowMetric = asAllowedEnum(row.metric, PERF_METRICS) as PerfMetric | undefined
      const rowSurface = asAllowedEnum(row.surface, PERF_SURFACES) as PerfSurface | undefined
      if (!rowMetric || !rowSurface || !isFiniteNumber(row.value)) {
        continue
      }
      const rowChannel = sanitizeChannel((row as { channel?: unknown }).channel)
      const rowComponent = sanitizeComponent((row as { component?: unknown }).component)
      const key = `${rowMetric}::${rowSurface}::${rowChannel ?? ''}::${rowComponent ?? ''}`
      const current = grouped.get(key) ?? {
        metric: rowMetric,
        surface: rowSurface,
        channel: rowChannel,
        component: rowComponent,
        values: [],
        errorCount: 0,
      }
      current.values.push(row.value)
      if (row.outcome === 'error' || row.outcome === 'timeout') {
        current.errorCount += 1
      }
      grouped.set(key, current)
    }

    const summaryRows = [...grouped.values()]
      .map(group => {
        const sorted = [...group.values].sort((left, right) => left - right)
        return {
          metric: group.metric,
          surface: group.surface,
          channel: group.channel,
          component: group.component,
          count: sorted.length,
          p50: quantile(sorted, 0.5),
          p95: quantile(sorted, 0.95),
          max: sorted.at(-1),
          errorCount: group.errorCount,
        } satisfies PerfSummaryRow
      })
      .sort((left, right) => (right.p95 ?? 0) - (left.p95 ?? 0))

    return summaryRows.slice(0, normalizeLimit(filter.limit, PERF_DEFAULT_SUMMARY_LIMIT))
  }

  listEvents(
    filter: {
      limit?: number
      sinceMs?: number
      includeInternalTelemetry?: boolean
      surfaces?: PerfSurface[]
    } = {}
  ): PerfEventEntry[] {
    const includeInternalTelemetry = filter.includeInternalTelemetry !== false
    const { where, params } = this.buildEventWhereClause({
      sinceMs: filter.sinceMs,
      includeInternalTelemetry,
      surfaces: normalizeSurfaceAllowlist(filter.surfaces),
    })
    const rows = this.database
      .prepare(
        `
          SELECT id, timestamp, surface, metric, kind, value, unit, outcome, trigger, process,
                 channel, component, workspace_hash, session_hash, thread_hash,
                 request_size_bucket, response_size_bucket, sample_rate
          FROM perf_events
          ${where}
          ORDER BY timestamp DESC
          LIMIT ?
        `
      )
      .all(...params, normalizeLimit(filter.limit, PERF_DEFAULT_EVENT_LIMIT)) as PerfEventRow[]

    return rows.flatMap(row => {
      const surface = asAllowedEnum(row.surface, PERF_SURFACES)
      const metric = asAllowedEnum(row.metric, PERF_METRICS)
      const kind = asAllowedEnum(row.kind, PERF_KINDS)
      const unit = asAllowedEnum(row.unit, PERF_UNITS)
      const outcome = asAllowedEnum(row.outcome, PERF_OUTCOMES)
      const trigger = asAllowedEnum(row.trigger, PERF_TRIGGERS)
      const requestSizeBucket = asAllowedEnum(row.request_size_bucket, PERF_SIZE_BUCKETS)
      const responseSizeBucket = asAllowedEnum(row.response_size_bucket, PERF_SIZE_BUCKETS)
      if (
        typeof row.id !== 'string' ||
        typeof row.timestamp !== 'number' ||
        !surface ||
        !metric ||
        !kind ||
        !unit ||
        (row.process !== 'renderer' && row.process !== 'main') ||
        !isFiniteNumber(row.value)
      ) {
        return []
      }
      return [
        {
          id: row.id,
          timestamp: row.timestamp,
          surface,
          metric,
          kind,
          value: row.value,
          unit,
          outcome,
          trigger,
          process: row.process,
          channel: sanitizeChannel(row.channel),
          component: sanitizeComponent(row.component),
          workspaceHash: asTrimmedString(row.workspace_hash, 64),
          sessionHash: asTrimmedString(row.session_hash, 64),
          threadHash: asTrimmedString(row.thread_hash, 64),
          requestSizeBucket,
          responseSizeBucket,
          sampleRate: isFiniteNumber(row.sample_rate) ? row.sample_rate : undefined,
        } satisfies PerfEventEntry,
      ]
    })
  }

  exportSnapshot(input: PerfSnapshotExportInput = {}): PerfSnapshotExport {
    const sinceMs = isFiniteNumber(input.sinceMs) && input.sinceMs > 0 ? input.sinceMs : 30 * 60_000
    const summaryLimit = normalizeLimit(input.summaryLimit, PERF_DEFAULT_SUMMARY_LIMIT)
    const includeEvents = input.includeEvents !== false
    const eventLimit = normalizeLimit(input.eventLimit, PERF_DEFAULT_EVENT_LIMIT)
    const includeInternalTelemetry = input.includeInternalTelemetry === true
    const minDurationMs = normalizeMinDuration(input.minDurationMs)
    const slowOnly = input.slowOnly !== false
    const surfaces = normalizeSurfaceAllowlist(input.surfaces)

    const allSummaryRows = this.listSummary({
      limit: 100_000,
      sinceMs,
      includeInternalTelemetry,
    })
    const rows = allSummaryRows
      .filter(row =>
        shouldIncludeExportSummary(row, {
          slowOnly,
          minDurationMs,
          surfaces,
        })
      )
      .slice(0, summaryLimit)

    const rawMatched = this.countEvents({
      sinceMs,
      includeInternalTelemetry,
      surfaces,
    })
    const internalTelemetryExcluded = includeInternalTelemetry
      ? 0
      : Math.max(
          0,
          this.countEvents({ sinceMs, includeInternalTelemetry: true, surfaces }) - rawMatched
        )
    let events: PerfEventEntry[] = []
    let matched = 0
    let priorityMatched = 0
    let priorityExported = 0

    if (includeEvents) {
      const allMatchingEvents = this.listEvents({
        limit: Math.max(eventLimit, rawMatched),
        sinceMs,
        includeInternalTelemetry,
        surfaces,
      })
      const filteredEvents = allMatchingEvents.filter(event =>
        shouldIncludeExportEvent(event, {
          slowOnly,
          minDurationMs,
          surfaces,
        })
      )
      matched = filteredEvents.length
      const prioritizedSelection = selectPrioritizedEvents(
        filteredEvents,
        eventLimit,
        minDurationMs
      )
      events = prioritizedSelection.selected
      priorityMatched = prioritizedSelection.priorityMatched
      priorityExported = prioritizedSelection.priorityExported
    }

    return {
      rows,
      events,
      filter: {
        sinceMs,
        summaryLimit,
        includeEvents,
        eventLimit,
        includeInternalTelemetry,
        minDurationMs,
        slowOnly,
        surfaces,
      },
      eventStats: {
        rawMatched,
        matched,
        exported: events.length,
        internalTelemetryExcluded,
        priorityMatched,
        priorityExported,
      },
    }
  }
}
