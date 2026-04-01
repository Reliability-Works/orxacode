/** @vitest-environment node */

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { PerformanceTelemetryService } from './performance-telemetry-service'

const tempDirs: string[] = []

async function createService() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'orxa-perf-'))
  tempDirs.push(dir)
  const databasePath = path.join(dir, 'state.sqlite')
  return {
    dir,
    databasePath,
    service: new PerformanceTelemetryService(databasePath),
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('PerformanceTelemetryService', () => {
  it('hashes identities and drops unsafe freeform strings before persistence', async () => {
    const { databasePath, service } = await createService()
    service.record({
      surface: 'session',
      metric: 'prompt.send_ack_ms',
      kind: 'span',
      value: 42,
      unit: 'ms',
      process: 'renderer',
      workspaceHash: '/Users/callumspencer/Repos/macapp/orxacode',
      sessionHash: 'session-raw-id',
      threadHash: 'thread-raw-id',
      channel: 'https://should-not-persist.example',
      component: 'component with spaces',
    })

    const db = new DatabaseSync(databasePath)
    const row = db
      .prepare(
        'SELECT workspace_hash, session_hash, thread_hash, channel, component FROM perf_events LIMIT 1'
      )
      .get() as
      | {
          workspace_hash?: string
          session_hash?: string
          thread_hash?: string
          channel?: string | null
          component?: string | null
        }
      | undefined

    expect(row?.workspace_hash).toMatch(/^[a-f0-9]{16}$/)
    expect(row?.session_hash).toMatch(/^[a-f0-9]{16}$/)
    expect(row?.thread_hash).toMatch(/^[a-f0-9]{16}$/)
    expect(row?.workspace_hash).not.toContain('/Users/callumspencer')
    expect(row?.session_hash).not.toContain('session-raw-id')
    expect(row?.channel).toBeNull()
    expect(row?.component).toBeNull()
  })

  it('ignores invalid metrics and builds grouped summaries for valid events', async () => {
    const { service } = await createService()
    const rejected = service.record({
      surface: 'session',
      metric: 'not.allowed' as never,
      kind: 'span',
      value: 12,
      unit: 'ms',
      process: 'renderer',
    })
    expect(rejected).toBeNull()

    service.record({
      surface: 'workspace',
      metric: 'workspace.refresh_ms',
      kind: 'span',
      value: 50,
      unit: 'ms',
      process: 'renderer',
    })
    service.record({
      surface: 'workspace',
      metric: 'workspace.refresh_ms',
      kind: 'span',
      value: 150,
      unit: 'ms',
      process: 'renderer',
      outcome: 'error',
    })

    const rows = service.listSummary({ surface: 'workspace' })
    expect(rows).toEqual([
      expect.objectContaining({
        metric: 'workspace.refresh_ms',
        surface: 'workspace',
        count: 2,
        p50: 50,
        p95: 50,
        max: 150,
        errorCount: 1,
      }),
    ])
  })

  it('exports summary rows and emits sanitized alerts for slow metrics', async () => {
    const { service } = await createService()
    const result = service.record({
      surface: 'workspace',
      metric: 'workspace.refresh_ms',
      kind: 'span',
      value: 2500,
      unit: 'ms',
      process: 'renderer',
    })

    expect(result?.alert).toEqual(
      expect.objectContaining({
        metric: 'workspace.refresh_ms',
        summary: 'slow workspace refresh',
      })
    )
    expect(service.exportSnapshot()).toEqual(
      expect.objectContaining({
        rows: [expect.objectContaining({ metric: 'workspace.refresh_ms', surface: 'workspace' })],
        events: [expect.objectContaining({ metric: 'workspace.refresh_ms', surface: 'workspace' })],
        filter: expect.objectContaining({
          includeInternalTelemetry: false,
          includeEvents: true,
          slowOnly: true,
        }),
        eventStats: expect.objectContaining({
          rawMatched: 1,
          matched: 1,
          exported: 1,
          internalTelemetryExcluded: 0,
          priorityMatched: 1,
          priorityExported: 1,
        }),
      })
    )
  })

  it('builds summary from full filtered window before applying row limit', async () => {
    const { service } = await createService()
    service.record({
      surface: 'workspace',
      metric: 'workspace.refresh_ms',
      kind: 'span',
      value: 500,
      unit: 'ms',
      process: 'renderer',
    })
    service.record({
      surface: 'workspace',
      metric: 'workspace.refresh_ms',
      kind: 'span',
      value: 700,
      unit: 'ms',
      process: 'renderer',
    })
    for (let index = 0; index < 200; index += 1) {
      service.record({
        surface: 'render',
        metric: 'render.commit_count',
        kind: 'counter',
        value: 1,
        unit: 'count',
        process: 'renderer',
      })
    }

    const rows = service.listSummary({ limit: 1 })
    expect(rows[0]).toEqual(
      expect.objectContaining({
        metric: 'workspace.refresh_ms',
        count: 2,
        p95: 500,
      })
    )
  })

  it('prioritizes key performance events when raw export is capped', async () => {
    const { service } = await createService()
    service.record({
      surface: 'session',
      metric: 'ipc.invoke_rtt_ms',
      kind: 'span',
      value: 980,
      unit: 'ms',
      process: 'renderer',
      channel: 'orxa:opencode:sendPrompt',
    })
    for (let index = 0; index < 240; index += 1) {
      service.record({
        surface: 'render',
        metric: 'render.commit_count',
        kind: 'counter',
        value: 1,
        unit: 'count',
        process: 'renderer',
      })
    }

    const snapshot = service.exportSnapshot({
      sinceMs: 10 * 60_000,
      eventLimit: 50,
      slowOnly: false,
    })
    if (!('path' in snapshot)) {
      expect(snapshot.events).toHaveLength(50)
      expect(snapshot.events.some(event => event.metric === 'ipc.invoke_rtt_ms')).toBe(true)
      expect(snapshot.eventStats.priorityMatched).toBeGreaterThanOrEqual(1)
      expect(snapshot.eventStats.priorityExported).toBeGreaterThanOrEqual(1)
    }
  })

  it('supports slow-only threshold and surface filtering for export', async () => {
    const { service } = await createService()
    service.record({
      surface: 'session',
      metric: 'session.runtime.load_ms',
      kind: 'span',
      value: 180,
      unit: 'ms',
      process: 'renderer',
      channel: 'orxa:opencode:getSessionRuntime',
    })
    service.record({
      surface: 'claude_chat',
      metric: 'ipc.invoke_rtt_ms',
      kind: 'span',
      value: 980,
      unit: 'ms',
      process: 'renderer',
      channel: 'orxa:claude-chat:getState',
    })

    const snapshot = service.exportSnapshot({
      minDurationMs: 500,
      surfaces: ['claude_chat'],
      slowOnly: true,
    })

    if (!('path' in snapshot)) {
      expect(snapshot.events).toHaveLength(1)
      expect(snapshot.events[0]?.surface).toBe('claude_chat')
      expect(snapshot.events[0]?.value).toBe(980)
      expect(snapshot.rows.every(row => row.surface === 'claude_chat')).toBe(true)
      expect(snapshot.filter.minDurationMs).toBe(500)
      expect(snapshot.filter.slowOnly).toBe(true)
      expect(snapshot.filter.surfaces).toEqual(['claude_chat'])
    }
  })

  it('excludes internal telemetry channels by default in exports', async () => {
    const { service } = await createService()
    service.record({
      surface: 'ipc',
      metric: 'ipc.handler_ms',
      kind: 'span',
      value: 1.5,
      unit: 'ms',
      process: 'main',
      channel: 'orxa:app:reportPerf',
    })
    service.record({
      surface: 'session',
      metric: 'session.runtime.load_ms',
      kind: 'span',
      value: 320,
      unit: 'ms',
      process: 'renderer',
    })

    const filtered = service.exportSnapshot()
    if (!('path' in filtered)) {
      expect(filtered.events).toHaveLength(1)
      expect(filtered.events[0]?.metric).toBe('session.runtime.load_ms')
      expect(filtered.eventStats.rawMatched).toBe(1)
      expect(filtered.eventStats.internalTelemetryExcluded).toBe(1)
      expect(filtered.eventStats.priorityMatched).toBe(1)
      expect(filtered.eventStats.priorityExported).toBe(1)
    }

    const unfiltered = service.exportSnapshot({ includeInternalTelemetry: true, slowOnly: false })
    if (!('path' in unfiltered)) {
      expect(unfiltered.events).toHaveLength(2)
      expect(unfiltered.eventStats.internalTelemetryExcluded).toBe(0)
      expect(unfiltered.eventStats.priorityMatched).toBe(1)
      expect(unfiltered.eventStats.priorityExported).toBe(1)
    }
  })
})
