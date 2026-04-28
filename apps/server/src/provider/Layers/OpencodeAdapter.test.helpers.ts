/**
 * Shared test doubles for the OpencodeAdapter runtime unit tests.
 *
 * Provides:
 *   - `FakeOpencodeRuntime`: records SDK calls and exposes a push-based event
 *     stream that the runtime module can subscribe to.
 *   - `makeFakeCreateRuntime`: returns a `createRuntime` override suitable for
 *     `OpencodeAdapterLiveOptions`, pointing at a shared `FakeOpencodeRuntime`
 *     instance or throwing on demand (spawn-failure scenarios).
 *   - `makeTestDeps`: assembles a minimal `OpencodeAdapterDeps` record backed
 *     by an Effect bounded queue and no-op server config / settings stubs.
 *   - `collectEvents`: drains a bounded number of events from the shared
 *     runtime queue into a plain array inside the active Effect.
 *
 * Zero `any` on purpose; every SDK mock uses the narrow helper types exported
 * from `OpencodeAdapter.sdk.ts` / `OpencodeAdapter.types.ts`.
 *
 * @module OpencodeAdapter.test.helpers
 */
import {
  DEFAULT_SERVER_SETTINGS,
  type ProviderRuntimeEvent,
  type ServerSettings,
  ThreadId,
} from '@orxa-code/contracts'
import { Effect, Option, Queue, Stream, type FileSystem } from 'effect'

import type { ServerConfigShape } from '../../config.ts'
import type { ServerSettingsShape } from '../../serverSettings.ts'
import { makeOpencodeAdapterDeps, type OpencodeAdapterDeps } from './OpencodeAdapter.deps.ts'
import type {
  OpencodeClient,
  OpencodeEvent,
  OpencodeClientRuntime,
  OpencodeSessionContext,
} from './OpencodeAdapter.types.ts'

export const TEST_THREAD_ID = ThreadId.makeUnsafe('thread-opencode-1')

export interface FakeSessionCreateCall {
  readonly directory?: string
}

export interface FakeSessionPromptCall {
  readonly sessionID: string
  readonly text: string
  readonly providerID: string
  readonly modelID: string
  readonly agent: string | undefined
  readonly variant: string | undefined
  readonly mode: 'promptAsync'
}

export interface FakeSessionAbortCall {
  readonly sessionID: string
}

interface EventPusher {
  push(event: OpencodeEvent): void
  close(): void
}

function createPushStream(): {
  stream: AsyncIterable<OpencodeEvent>
  push: EventPusher['push']
  close: EventPusher['close']
} {
  const buffer: Array<OpencodeEvent> = []
  const waiters: Array<(result: IteratorResult<OpencodeEvent>) => void> = []
  let closed = false

  const push = (event: OpencodeEvent): void => {
    if (closed) return
    const waiter = waiters.shift()
    if (waiter) {
      waiter({ done: false, value: event })
      return
    }
    buffer.push(event)
  }
  const close = (): void => {
    if (closed) return
    closed = true
    for (const waiter of waiters.splice(0)) {
      waiter({ done: true, value: undefined })
    }
  }
  const iterator: AsyncIterator<OpencodeEvent> = {
    next: () => {
      const value = buffer.shift()
      if (value !== undefined) {
        return Promise.resolve({ done: false, value })
      }
      if (closed) {
        return Promise.resolve({ done: true, value: undefined })
      }
      return new Promise(resolve => {
        waiters.push(resolve)
      })
    },
  }
  const stream: AsyncIterable<OpencodeEvent> = {
    [Symbol.asyncIterator]: () => iterator,
  }
  return { stream, push, close }
}

export interface FakeOpencodeRuntime extends OpencodeClientRuntime {
  readonly sessionCreateCalls: ReadonlyArray<FakeSessionCreateCall>
  readonly sessionPromptCalls: ReadonlyArray<FakeSessionPromptCall>
  readonly sessionAbortCalls: ReadonlyArray<FakeSessionAbortCall>
  readonly shutdownCalls: { readonly count: number }
  readonly sessionId: string
  readonly pushEvent: (event: OpencodeEvent) => void
  readonly closeEventStream: () => void
  readonly failSessionCreate: (error: Error) => void
  readonly failSessionPrompt: (error: Error) => void
}

interface FakeRuntimeBuckets {
  readonly sessionCreateCalls: Array<FakeSessionCreateCall>
  readonly sessionPromptCalls: Array<FakeSessionPromptCall>
  readonly sessionAbortCalls: Array<FakeSessionAbortCall>
  readonly failures: { create?: Error; prompt?: Error }
  readonly sessionId: string
  readonly stream: AsyncIterable<OpencodeEvent>
}

function buildFakeOpencodeClient(buckets: FakeRuntimeBuckets): OpencodeClient {
  return {
    session: {
      create: async (body?: { directory?: string }) => {
        if (buckets.failures.create) throw buckets.failures.create
        buckets.sessionCreateCalls.push(body?.directory ? { directory: body.directory } : {})
        return {
          data: {
            id: buckets.sessionId,
            slug: 'fake-slug',
            projectID: 'proj-fake',
            directory: body?.directory ?? '/tmp/fake',
            title: 'fake',
            version: '0.0.0',
            time: { created: 0, updated: 0 },
          },
        }
      },
      promptAsync: async (body: {
        sessionID: string
        model: { providerID: string; modelID: string }
        parts: ReadonlyArray<{ type: string; text: string }>
        agent?: string
        variant?: string
      }) => {
        if (buckets.failures.prompt) throw buckets.failures.prompt
        const firstPart = body.parts[0]
        buckets.sessionPromptCalls.push({
          sessionID: body.sessionID,
          text: firstPart && firstPart.type === 'text' ? firstPart.text : '',
          providerID: body.model.providerID,
          modelID: body.model.modelID,
          agent: body.agent,
          variant: body.variant,
          mode: 'promptAsync',
        })
        return { data: { info: undefined, parts: [] } }
      },
      abort: async (body: { sessionID: string }) => {
        buckets.sessionAbortCalls.push({ sessionID: body.sessionID })
        return { data: true }
      },
    },
    event: {
      subscribe: async () => ({ stream: buckets.stream }),
    },
  } as unknown as OpencodeClient
}

export function createFakeOpencodeRuntime(config?: {
  readonly sessionId?: string
}): FakeOpencodeRuntime {
  const sessionId = config?.sessionId ?? 'sess-fake-123'
  const sessionCreateCalls: Array<FakeSessionCreateCall> = []
  const sessionPromptCalls: Array<FakeSessionPromptCall> = []
  const sessionAbortCalls: Array<FakeSessionAbortCall> = []
  const shutdownCalls = { count: 0 }
  const { stream, push, close } = createPushStream()
  const failures: { create?: Error; prompt?: Error } = {}

  const fakeClient = buildFakeOpencodeClient({
    sessionCreateCalls,
    sessionPromptCalls,
    sessionAbortCalls,
    failures,
    sessionId,
    stream,
  })

  const shutdown = async (): Promise<void> => {
    shutdownCalls.count += 1
    close()
  }

  return {
    client: fakeClient,
    port: 0,
    shutdown,
    sessionCreateCalls,
    sessionPromptCalls,
    sessionAbortCalls,
    shutdownCalls,
    sessionId,
    pushEvent: push,
    closeEventStream: close,
    failSessionCreate: error => {
      failures.create = error
    },
    failSessionPrompt: error => {
      failures.prompt = error
    },
  }
}

export type FakeCreateRuntime = (input: {
  readonly binaryPath: string
}) => Promise<OpencodeClientRuntime>

export function makeFakeCreateRuntime(
  runtime: FakeOpencodeRuntime | (() => never)
): FakeCreateRuntime {
  return async () => {
    if (typeof runtime === 'function') {
      return runtime()
    }
    return runtime
  }
}

function makeFakeServerConfig(): ServerConfigShape {
  return {
    logLevel: 'Error',
    mode: 'web',
    port: 0,
    host: undefined,
    cwd: '/tmp/opencode-adapter-test',
    baseDir: '/tmp/opencode-adapter-test-base',
    staticDir: undefined,
    devUrl: undefined,
    noBrowser: true,
    authToken: undefined,
    remoteAccessBootstrapToken: undefined,
    remoteAccessEnvironmentId: undefined,
    autoBootstrapProjectFromCwd: false,
    logWebSocketEvents: false,
    stateDir: '/tmp/opencode-adapter-test/state',
    dbPath: '/tmp/opencode-adapter-test/state/db.sqlite',
    keybindingsConfigPath: '/tmp/opencode-adapter-test/state/keybindings.json',
    settingsPath: '/tmp/opencode-adapter-test/state/settings.json',
    worktreesDir: '/tmp/opencode-adapter-test/worktrees',
    attachmentsDir: '/tmp/opencode-adapter-test/state/attachments',
    logsDir: '/tmp/opencode-adapter-test/state/logs',
    serverLogPath: '/tmp/opencode-adapter-test/state/logs/server.log',
    serverTracePath: '/tmp/opencode-adapter-test/state/logs/server.trace.ndjson',
    providerLogsDir: '/tmp/opencode-adapter-test/state/logs/provider',
    providerEventLogPath: '/tmp/opencode-adapter-test/state/logs/provider/events.log',
    terminalLogsDir: '/tmp/opencode-adapter-test/state/logs/terminals',
    anonymousIdPath: '/tmp/opencode-adapter-test/state/anonymous-id',
    traceMinLevel: 'Info',
    traceTimingEnabled: true,
    traceMaxBytes: 5 * 1024 * 1024,
    traceMaxFiles: 5,
    traceBatchWindowMs: 250,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpExportIntervalMs: 5000,
    otlpServiceName: 'orxacode-server',
  }
}

function makeFakeServerSettings(binaryPath: string): ServerSettingsShape {
  const settings: ServerSettings = {
    ...DEFAULT_SERVER_SETTINGS,
    providers: {
      ...DEFAULT_SERVER_SETTINGS.providers,
      opencode: {
        ...DEFAULT_SERVER_SETTINGS.providers.opencode,
        binaryPath,
      },
    },
  }
  return {
    start: Effect.void,
    ready: Effect.void,
    getSettings: Effect.succeed(settings),
    updateSettings: () => Effect.succeed(settings),
    streamChanges: Stream.empty,
  }
}

export interface MakeTestDepsInput {
  readonly createRuntime: FakeCreateRuntime
  readonly binaryPath?: string
  readonly fileSystem?: FileSystem.FileSystem
}

export interface TestDepsHandle {
  readonly deps: OpencodeAdapterDeps
  readonly sessions: Map<ThreadId, OpencodeSessionContext>
  readonly runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>
}

export function makeTestDeps(input: MakeTestDepsInput): Effect.Effect<TestDepsHandle> {
  return Effect.gen(function* () {
    const sessions = new Map<ThreadId, OpencodeSessionContext>()
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>()
    const fileSystemStub = (input.fileSystem ??
      ({} as FileSystem.FileSystem)) as FileSystem.FileSystem
    const deps = makeOpencodeAdapterDeps({
      fileSystem: fileSystemStub,
      serverConfig: makeFakeServerConfig(),
      serverSettingsService: makeFakeServerSettings(input.binaryPath ?? '/usr/bin/opencode'),
      sessions,
      runtimeEventQueue,
      options: { createRuntime: input.createRuntime },
    })
    return { deps, sessions, runtimeEventQueue }
  })
}

export function collectEvents(
  queue: Queue.Queue<ProviderRuntimeEvent>,
  count: number
): Effect.Effect<ReadonlyArray<ProviderRuntimeEvent>> {
  return Effect.gen(function* () {
    const out: Array<ProviderRuntimeEvent> = []
    for (let index = 0; index < count; index += 1) {
      const event = yield* Queue.take(queue)
      out.push(event)
    }
    return out
  })
}

export function drainEvents(
  queue: Queue.Queue<ProviderRuntimeEvent>
): Effect.Effect<ReadonlyArray<ProviderRuntimeEvent>> {
  return Effect.gen(function* () {
    const out: Array<ProviderRuntimeEvent> = []
    for (;;) {
      const next = yield* Queue.poll(queue)
      if (Option.isNone(next)) return out
      out.push(next.value)
    }
  })
}
