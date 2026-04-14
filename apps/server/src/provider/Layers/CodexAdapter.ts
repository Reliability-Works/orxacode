/**
 * CodexAdapterLive - Scoped live implementation for the Codex provider adapter.
 *
 * Wraps `CodexAppServerManager` behind the `CodexAdapter` service contract and
 * translates manager events into canonical runtime events.
 *
 * @module CodexAdapterLive
 */
import { type ProviderEvent, type ProviderRuntimeEvent, type ThreadId } from '@orxa-code/contracts'
import { Effect, FileSystem, Layer, Queue, ServiceMap, Stream } from 'effect'
import { lookupModelContextWindow } from '@orxa-code/shared/modelContextWindow'

import { CodexAdapter, type CodexAdapterShape } from '../Services/CodexAdapter.ts'
import { CodexAppServerManager } from '../../codexAppServerManager.ts'
import { ServerConfig } from '../../config.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { type EventNdjsonLogger, makeEventNdjsonLogger } from './EventNdjsonLogger.ts'
import { createCodexAdapterOperations } from './CodexAdapterOperations.ts'
import { CODEX_PROVIDER } from './CodexAdapterShared.ts'
import { mapToRuntimeEvents } from './CodexRuntimeEventMapper.ts'

export interface CodexAdapterLiveOptions {
  readonly manager?: CodexAppServerManager
  readonly makeManager?: (services?: ServiceMap.ServiceMap<never>) => CodexAppServerManager
  readonly nativeEventLogPath?: string
  readonly nativeEventLogger?: EventNdjsonLogger
}

const createNativeEventLogger = Effect.fn('createNativeEventLogger')(function* (
  options?: CodexAdapterLiveOptions
) {
  return (
    options?.nativeEventLogger ??
    (options?.nativeEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
          stream: 'native',
        })
      : undefined)
  )
})

const acquireManager = Effect.fn('acquireCodexManager')(function* (
  options?: CodexAdapterLiveOptions
) {
  if (options?.manager) {
    return options.manager
  }
  const services = yield* Effect.services<never>()
  return options?.makeManager?.(services) ?? new CodexAppServerManager(services)
})

const releaseManager = (manager: CodexAppServerManager) =>
  Effect.sync(() => {
    try {
      manager.stopAll()
    } catch {
      // Finalizers should never fail and block shutdown.
    }
  })

/**
 * Enrich a runtime event with `maxTokens` derived from the static model
 * context-window registry when the codex SDK didn't supply one. Operates
 * only on `thread.token-usage.updated` events whose payload is missing
 * `maxTokens`; everything else passes through unchanged.
 *
 * The codex SDK historically emitted `model_context_window` on its token
 * usage event, but recent CLI versions sometimes omit it — without this
 * fallback the composer's "% of context used" meter renders the raw token
 * count (e.g. "184") instead of a percentage.
 */
function enrichTokenUsageMaxTokens(
  event: ProviderRuntimeEvent,
  modelId: string | undefined
): ProviderRuntimeEvent {
  if (event.type !== 'thread.token-usage.updated') return event
  const usage = event.payload.usage
  if (usage?.maxTokens !== undefined) return event
  const fallback = lookupModelContextWindow(modelId)
  if (fallback === undefined) return event
  return {
    ...event,
    payload: { ...event.payload, usage: { ...usage, maxTokens: fallback } },
  }
}

const registerListener = Effect.fn('registerCodexListener')(function* (
  manager: CodexAppServerManager,
  runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>,
  nativeEventLogger: EventNdjsonLogger | undefined,
  latestModelByThread: Map<ThreadId, string>
) {
  const services = yield* Effect.services<never>()
  const listenerEffect = Effect.fn('codexListener')(function* (event: ProviderEvent) {
    if (nativeEventLogger) {
      yield* nativeEventLogger.write(event, event.threadId)
    }
    const rawEvents = mapToRuntimeEvents(event, event.threadId)
    if (rawEvents.length === 0) {
      yield* Effect.logDebug('ignoring unhandled Codex provider event', {
        method: event.method,
        threadId: event.threadId,
        turnId: event.turnId,
        itemId: event.itemId,
      })
      return
    }
    const knownModel = latestModelByThread.get(event.threadId)
    const runtimeEvents = rawEvents.map(e => enrichTokenUsageMaxTokens(e, knownModel))
    yield* Queue.offerAll(runtimeEventQueue, runtimeEvents)
  })

  const listener = (event: ProviderEvent) =>
    listenerEffect(event).pipe(Effect.runPromiseWith(services))
  manager.on('event', listener)
  return listener
})

const unregisterListener = Effect.fn('unregisterCodexListener')(function* (
  manager: CodexAppServerManager,
  runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>,
  listener: (event: ProviderEvent) => Promise<void>
) {
  yield* Effect.sync(() => {
    manager.off('event', listener)
  })
  yield* Queue.shutdown(runtimeEventQueue)
})

const makeCodexAdapter = Effect.fn('makeCodexAdapter')(function* (
  options?: CodexAdapterLiveOptions
) {
  const fileSystem = yield* FileSystem.FileSystem
  const { attachmentsDir } = yield* Effect.service(ServerConfig)
  const nativeEventLogger = yield* createNativeEventLogger(options)
  const manager = yield* Effect.acquireRelease(acquireManager(options), releaseManager)
  const serverSettingsService = yield* ServerSettingsService
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>()

  // Per-thread latest model id, populated whenever the orchestration layer
  // hands us a `modelSelection` on startSession/sendTurn. Used as a fallback
  // source for `maxTokens` on `thread.token-usage.updated` events when the
  // codex SDK doesn't include `model_context_window` in the payload.
  const latestModelByThread = new Map<ThreadId, string>()

  const baseOperations = createCodexAdapterOperations({
    manager,
    attachmentsDir,
    fileSystem,
    serverSettingsService,
  })

  // Wrap startSession/sendTurn so we can capture the requested codex model
  // before delegating. We don't observe the manager's response here — we
  // record what the caller asked for, which is what determines the model
  // context window the SDK ends up using for the upcoming turn.
  const recordModel = (
    threadId: ThreadId,
    modelSelection: { readonly provider: string; readonly model?: string | null } | null | undefined
  ) => {
    if (modelSelection?.provider !== CODEX_PROVIDER) return
    const model = modelSelection.model
    if (typeof model === 'string' && model.trim().length > 0) {
      latestModelByThread.set(threadId, model)
    }
  }
  const operations: typeof baseOperations = {
    ...baseOperations,
    startSession: input =>
      Effect.sync(() => recordModel(input.threadId, input.modelSelection ?? null)).pipe(
        Effect.flatMap(() => baseOperations.startSession(input))
      ),
    sendTurn: input =>
      Effect.sync(() => recordModel(input.threadId, input.modelSelection ?? null)).pipe(
        Effect.flatMap(() => baseOperations.sendTurn(input))
      ),
  }

  yield* Effect.acquireRelease(
    registerListener(manager, runtimeEventQueue, nativeEventLogger, latestModelByThread),
    listener => unregisterListener(manager, runtimeEventQueue, listener)
  )

  return {
    provider: CODEX_PROVIDER,
    capabilities: {
      sessionModelSwitch: 'in-session',
    },
    ...operations,
    streamEvents: Stream.fromQueue(runtimeEventQueue),
  } satisfies CodexAdapterShape
})

export const CodexAdapterLive = Layer.effect(CodexAdapter, makeCodexAdapter())

export function makeCodexAdapterLive(options?: CodexAdapterLiveOptions) {
  return Layer.effect(CodexAdapter, makeCodexAdapter(options))
}
