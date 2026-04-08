/**
 * ClaudeAdapterLive - Scoped live implementation for the Claude Agent provider adapter.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk` query sessions behind the generic
 * provider adapter contract and emits canonical runtime events. The pure
 * helper primitives live in sibling modules (`ClaudeAdapter.pure.ts`,
 * `ClaudeAdapter.sdk.ts`); the live runtime helpers live in the
 * `ClaudeAdapter.runtime.*.ts` sibling modules; shared types live in
 * `ClaudeAdapter.types.ts`; the dependency surface shared by runtime helpers
 * lives in `ClaudeAdapter.deps.ts`.
 *
 * The generator body below is intentionally a thin wiring shell: it yields
 * the Effect services that build the shared `ClaudeAdapterDeps` value, then
 * returns a `ClaudeAdapterShape` whose methods delegate to the runtime helper
 * modules. All streaming semantics, approval flows, session lifecycle, and
 * user-input routing are preserved exactly as they were before the
 * extraction — only the physical location of each helper changed.
 *
 * @module ClaudeAdapterLive
 */
import {
  type Options as ClaudeQueryOptions,
  query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { type ProviderRuntimeEvent, type ThreadId } from '@orxa-code/contracts'
import { Effect, FileSystem, Layer, Queue, Stream } from 'effect'

import { ServerConfig } from '../../config.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { ClaudeAdapter, type ClaudeAdapterShape } from '../Services/ClaudeAdapter.ts'
import { makeClaudeAdapterDeps } from './ClaudeAdapter.deps.ts'
import {
  hasSession,
  interruptTurn,
  listSessions,
  readThread,
  respondToRequest,
  respondToUserInput,
  rollbackThread,
  sendTurn,
  stopAll,
  stopSession,
} from './ClaudeAdapter.runtime.methods.ts'
import { startSession, stopSessionInternal } from './ClaudeAdapter.runtime.session.ts'
import {
  PROVIDER,
  type ClaudeAdapterLiveOptions,
  type ClaudeQueryRuntime,
  type ClaudeSessionContext,
} from './ClaudeAdapter.types.ts'
import { makeEventNdjsonLogger } from './EventNdjsonLogger.ts'

const makeClaudeAdapter = Effect.fn('makeClaudeAdapter')(function* (
  options?: ClaudeAdapterLiveOptions
) {
  const fileSystem = yield* FileSystem.FileSystem
  const serverConfig = yield* ServerConfig
  const serverSettingsService = yield* ServerSettingsService
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>()
  const nativeEventLogger =
    options?.nativeEventLogger ??
    (options?.nativeEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
          stream: 'native',
        })
      : undefined)

  const createQuery =
    options?.createQuery ??
    ((input: {
      readonly prompt: AsyncIterable<SDKUserMessage>
      readonly options: ClaudeQueryOptions
    }) => query({ prompt: input.prompt, options: input.options }) as ClaudeQueryRuntime)

  const sessions = new Map<ThreadId, ClaudeSessionContext>()

  const deps = makeClaudeAdapterDeps({
    fileSystem,
    serverConfig,
    serverSettingsService,
    nativeEventLogger,
    createQuery,
    sessions,
    runtimeEventQueue,
  })

  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      sessions,
      ([, context]) =>
        stopSessionInternal(deps, context, {
          emitExitEvent: false,
        }),
      { discard: true }
    ).pipe(Effect.tap(() => Queue.shutdown(runtimeEventQueue)))
  )

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: 'in-session',
    },
    startSession: startSession(deps),
    sendTurn: sendTurn(deps),
    interruptTurn: interruptTurn(deps),
    readThread: readThread(deps),
    rollbackThread: rollbackThread(deps),
    respondToRequest: respondToRequest(deps),
    respondToUserInput: respondToUserInput(deps),
    stopSession: stopSession(deps),
    listSessions: listSessions(deps),
    hasSession: hasSession(deps),
    stopAll: stopAll(deps),
    streamEvents: Stream.fromQueue(runtimeEventQueue),
  } satisfies ClaudeAdapterShape
})

export const ClaudeAdapterLive = Layer.effect(ClaudeAdapter, makeClaudeAdapter())

export function makeClaudeAdapterLive(options?: ClaudeAdapterLiveOptions) {
  return Layer.effect(ClaudeAdapter, makeClaudeAdapter(options))
}

export type { ClaudeAdapterLiveOptions } from './ClaudeAdapter.types.ts'
