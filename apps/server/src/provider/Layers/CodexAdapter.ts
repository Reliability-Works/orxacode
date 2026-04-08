/**
 * CodexAdapterLive - Scoped live implementation for the Codex provider adapter.
 *
 * Wraps `CodexAppServerManager` behind the `CodexAdapter` service contract and
 * translates manager events into canonical runtime events.
 *
 * @module CodexAdapterLive
 */
import { type ProviderEvent, type ProviderRuntimeEvent } from '@orxa-code/contracts'
import { Effect, FileSystem, Layer, Queue, ServiceMap, Stream } from 'effect'

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

const registerListener = Effect.fn('registerCodexListener')(function* (
  manager: CodexAppServerManager,
  runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>,
  nativeEventLogger: EventNdjsonLogger | undefined
) {
  const services = yield* Effect.services<never>()
  const listenerEffect = Effect.fn('codexListener')(function* (event: ProviderEvent) {
    if (nativeEventLogger) {
      yield* nativeEventLogger.write(event, event.threadId)
    }
    const runtimeEvents = mapToRuntimeEvents(event, event.threadId)
    if (runtimeEvents.length === 0) {
      yield* Effect.logDebug('ignoring unhandled Codex provider event', {
        method: event.method,
        threadId: event.threadId,
        turnId: event.turnId,
        itemId: event.itemId,
      })
      return
    }
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

  const operations = createCodexAdapterOperations({
    manager,
    attachmentsDir,
    fileSystem,
    serverSettingsService,
  })

  yield* Effect.acquireRelease(
    registerListener(manager, runtimeEventQueue, nativeEventLogger),
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
