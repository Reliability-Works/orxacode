/**
 * OpencodeAdapterLive - Scoped live implementation for the Opencode provider adapter.
 *
 * Wraps `@opencode-ai/sdk/v2/client` sessions and the `opencode serve`
 * subprocess lifecycle behind the generic provider adapter contract and
 * emits canonical runtime events. Pure helpers and SDK wrappers live in
 * sibling modules (`OpencodeAdapter.pure.ts`, `OpencodeAdapter.sdk.ts`); the
 * runtime helpers live in `OpencodeAdapter.runtime.*.ts`; shared types live
 * in `OpencodeAdapter.types.ts`; the dependency surface shared by runtime
 * helpers lives in `OpencodeAdapter.deps.ts`.
 *
 * The generator body below is intentionally a thin wiring shell: it yields
 * the Effect services that build the shared `OpencodeAdapterDeps` value,
 * registers a finalizer that stops every live session and shuts down the
 * runtime event queue, and returns an `OpencodeAdapterShape` whose methods
 * delegate to the runtime helper modules. All streaming semantics, turn
 * lifecycle, and session lifecycle are preserved exactly as f04 implemented
 * them — only the physical assembly of the adapter changed.
 *
 * @module OpencodeAdapterLive
 */
import { type OpencodeAgent, type ProviderRuntimeEvent, type ThreadId } from '@orxa-code/contracts'
import { Cache, Duration, Effect, FileSystem, Layer, Queue, Stream } from 'effect'

import { ServerConfig } from '../../config.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import {
  listOpencodePrimaryAgents,
  type ListOpencodePrimaryAgentsInput,
} from '../opencodeAgents.ts'
import { OpencodeAdapter, type OpencodeAdapterShape } from '../Services/OpencodeAdapter.ts'
import {
  assembleProviderAdapterShape,
  buildAdapterCleanupFinalizer,
} from './ProviderAdapter.shared.ts'
import { makeOpencodeAdapterDeps } from './OpencodeAdapter.deps.ts'
import {
  hasSession,
  listSessions,
  readThread,
  respondToRequest,
  respondToUserInput,
  rollbackThread,
  stopAll,
  stopSession,
} from './OpencodeAdapter.runtime.methods.ts'
import { startSession, stopSessionInternal } from './OpencodeAdapter.runtime.session.ts'
import { interruptTurn, sendTurn } from './OpencodeAdapter.runtime.turns.ts'
import {
  PROVIDER,
  type OpencodeAdapterLiveOptions,
  type OpencodeSessionContext,
} from './OpencodeAdapter.types.ts'

const makeOpencodeAdapter = Effect.fn('makeOpencodeAdapter')(function* (
  options?: OpencodeAdapterLiveOptions
) {
  const fileSystem = yield* FileSystem.FileSystem
  const serverConfig = yield* ServerConfig
  const serverSettingsService = yield* ServerSettingsService
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>()

  const sessions = new Map<ThreadId, OpencodeSessionContext>()

  const deps = makeOpencodeAdapterDeps({
    fileSystem,
    serverConfig,
    serverSettingsService,
    sessions,
    runtimeEventQueue,
    options,
  })

  yield* Effect.addFinalizer(() =>
    buildAdapterCleanupFinalizer({
      sessions,
      runtimeEventQueue,
      stopSession: context => stopSessionInternal(deps, context, { emitExitEvent: false }),
    })
  )

  const turnMethods = {
    sendTurn: sendTurn(deps),
    interruptTurn: interruptTurn(deps),
  } as const
  const threadMethods = {
    readThread: readThread(deps),
    rollbackThread: rollbackThread(deps),
  } as const
  const requestMethods = {
    respondToRequest: respondToRequest(),
    respondToUserInput: respondToUserInput(),
  } as const
  const lifecycleMethods = {
    startSession: startSession(deps),
    stopSession: stopSession(deps),
    listSessions: listSessions(deps),
    hasSession: hasSession(deps),
    stopAll: stopAll(deps),
  } as const
  const primaryAgentsCache = yield* Cache.make({
    capacity: 1,
    timeToLive: Duration.minutes(5),
    lookup: (key: 'agents'): Effect.Effect<ReadonlyArray<OpencodeAgent>> => {
      void key
      const probeInput: ListOpencodePrimaryAgentsInput = {}
      return Effect.tryPromise(() => listOpencodePrimaryAgents(probeInput)).pipe(
        Effect.orElseSucceed(() => [] as ReadonlyArray<OpencodeAgent>)
      )
    },
  })
  const listPrimaryAgents = (): Effect.Effect<ReadonlyArray<OpencodeAgent>> =>
    Cache.get(primaryAgentsCache, 'agents') as Effect.Effect<ReadonlyArray<OpencodeAgent>>

  const baseShape = assembleProviderAdapterShape({
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: 'in-session' as const },
    methods: {
      ...lifecycleMethods,
      ...turnMethods,
      ...threadMethods,
      ...requestMethods,
      streamEvents: Stream.fromQueue(runtimeEventQueue),
    },
  })
  return {
    ...baseShape,
    listPrimaryAgents,
  } satisfies OpencodeAdapterShape
})

export const OpencodeAdapterLive = Layer.effect(OpencodeAdapter, makeOpencodeAdapter())

export function makeOpencodeAdapterLive(options?: OpencodeAdapterLiveOptions) {
  return Layer.effect(OpencodeAdapter, makeOpencodeAdapter(options))
}

export type { OpencodeAdapterLiveOptions } from './OpencodeAdapter.types.ts'
