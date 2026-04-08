import { Effect, PubSub, Queue, Stream } from 'effect'
import type { ProviderRuntimeEvent } from '@orxa-code/contracts'

import { createProviderServiceOperations } from './ProviderService.operations.ts'
import {
  createPublishRuntimeEvent,
  createRecoverSessionForThread,
  createResolveRoutableSession,
  createUpsertSessionBinding,
  type ProviderServiceRuntimeDeps,
} from './ProviderService.shared.ts'

const setupRuntimeEventFanout = Effect.fn('setupRuntimeEventFanout')(function* (
  deps: ProviderServiceRuntimeDeps
) {
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>()
  const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>()
  const publishRuntimeEvent = createPublishRuntimeEvent(
    runtimeEventPubSub,
    deps.canonicalEventLogger
  )
  const providers = yield* deps.registry.listProviders()
  const adapters = yield* Effect.forEach(providers, provider =>
    deps.registry.getByProvider(provider)
  )

  yield* Effect.forkScoped(
    Effect.forever(Queue.take(runtimeEventQueue).pipe(Effect.flatMap(publishRuntimeEvent)))
  )
  yield* Effect.forEach(adapters, adapter =>
    Stream.runForEach(adapter.streamEvents, event =>
      Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid)
    ).pipe(Effect.forkScoped)
  ).pipe(Effect.asVoid)

  return {
    adapters,
    runtimeEventPubSub,
  } as const
})

export const makeProviderServiceRuntime = Effect.fn('makeProviderServiceRuntime')(function* (
  deps: ProviderServiceRuntimeDeps
) {
  const { adapters, runtimeEventPubSub } = yield* setupRuntimeEventFanout(deps)
  const upsertSessionBinding = createUpsertSessionBinding(deps.directory)
  const recoverSessionForThread = createRecoverSessionForThread({
    registry: deps.registry,
    analytics: deps.analytics,
    upsertSessionBinding,
  })
  const resolveRoutableSession = createResolveRoutableSession({
    registry: deps.registry,
    directory: deps.directory,
    recoverSessionForThread,
  })

  return createProviderServiceOperations({
    deps,
    adapters,
    resolveRoutableSession,
    upsertSessionBinding,
    runtimeEventPubSub,
  })
})
