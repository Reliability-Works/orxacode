/**
 * Shared dependency surface for the Claude adapter helper modules.
 *
 * The Claude provider runtime layer is composed of cohesive helper groups
 * (streaming, approvals, session, turn). Each group is implemented as a
 * sibling module exporting plain functions that take a `ClaudeAdapterDeps`
 * value built once inside the layer's `Effect.gen` body. This module owns
 * the dependency surface so the helper modules can stay decoupled from
 * the layer wiring shell.
 *
 * @module ClaudeAdapter.deps
 */
import type { Options as ClaudeQueryOptions, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { EventId, type ProviderRuntimeEvent, type ThreadId } from '@orxa-code/contracts'
import { DateTime, Effect, type FileSystem, Queue, Random } from 'effect'

import type { ServerConfigShape } from '../../config.ts'
import type { ServerSettingsShape } from '../../serverSettings.ts'
import type { ClaudeQueryRuntime, ClaudeSessionContext } from './ClaudeAdapter.types.ts'
import type { EventNdjsonLogger } from './EventNdjsonLogger.ts'

export interface ClaudeAdapterDeps {
  readonly fileSystem: FileSystem.FileSystem
  readonly serverConfig: ServerConfigShape
  readonly serverSettingsService: ServerSettingsShape
  readonly nativeEventLogger: EventNdjsonLogger | undefined
  readonly createQuery: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>
    readonly options: ClaudeQueryOptions
  }) => ClaudeQueryRuntime
  readonly sessions: Map<ThreadId, ClaudeSessionContext>
  readonly runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>
  readonly nowIso: Effect.Effect<string>
  readonly nextEventId: Effect.Effect<EventId>
  readonly makeEventStamp: () => Effect.Effect<{
    readonly eventId: EventId
    readonly createdAt: string
  }>
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>
}

export const makeClaudeAdapterDeps = (input: {
  readonly fileSystem: FileSystem.FileSystem
  readonly serverConfig: ServerConfigShape
  readonly serverSettingsService: ServerSettingsShape
  readonly nativeEventLogger: EventNdjsonLogger | undefined
  readonly createQuery: ClaudeAdapterDeps['createQuery']
  readonly sessions: Map<ThreadId, ClaudeSessionContext>
  readonly runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>
}): ClaudeAdapterDeps => {
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso)
  const nextEventId = Effect.map(Random.nextUUIDv4, id => EventId.makeUnsafe(id))
  const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso })
  const offerRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Queue.offer(input.runtimeEventQueue, event).pipe(Effect.asVoid)
  return {
    fileSystem: input.fileSystem,
    serverConfig: input.serverConfig,
    serverSettingsService: input.serverSettingsService,
    nativeEventLogger: input.nativeEventLogger,
    createQuery: input.createQuery,
    sessions: input.sessions,
    runtimeEventQueue: input.runtimeEventQueue,
    nowIso,
    nextEventId,
    makeEventStamp,
    offerRuntimeEvent,
  }
}
