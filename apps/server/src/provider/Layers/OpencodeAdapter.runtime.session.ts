/**
 * Opencode adapter runtime session-lifecycle helpers.
 *
 * Spawns an `opencode serve` subprocess per provider session via the shared
 * `createRuntime` dep, creates an opencode SDK session, opens the event
 * subscribe stream, and funnels produced events through the f03 pure mapper
 * into the shared runtime event queue. Also owns the `stopSessionInternal`
 * finalizer: interrupts the subscribe fiber, best-effort SDK abort, shuts
 * down the subprocess, clears the partHint cache, and flips the session to
 * `closed`.
 *
 * No Effect service tag in f04 — f05 will bind these helpers onto an adapter
 * Layer. Runtime callers (the tests and the future Layer) construct an
 * `OpencodeAdapterDeps` record via `makeOpencodeAdapterDeps` and invoke the
 * exported functions directly.
 *
 * @module OpencodeAdapter.runtime.session
 */
import { type ProviderSession, type ProviderSessionStartInput } from '@orxa-code/contracts'
import { Effect } from 'effect'

import { type ProviderAdapterError, ProviderAdapterProcessError } from '../Errors.ts'
import type { OpencodeAdapterDeps } from './OpencodeAdapter.deps.ts'
import { ensureSessionStartProviderMatches } from './ProviderAdapter.shared.ts'
import {
  abortOpencodeSessionIgnoring,
  createPartHintCache,
  emitSessionExitedEvent,
  emitSessionStartedEvent,
  readPartHintFromEvent,
  type PartHintCache,
} from './OpencodeAdapter.runtime.eventBase.ts'
import {
  attachEventStreamFiber,
  type EventStreamRunFork,
} from './OpencodeAdapter.runtime.events.ts'
import { createOpencodeSession, subscribeOpencodeEvents } from './OpencodeAdapter.sdk.ts'
import {
  PROVIDER,
  type OpencodeClientRuntime,
  type OpencodeSessionContext,
} from './OpencodeAdapter.types.ts'

function toErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  return fallback
}

const acquireOpencodeRuntime = Effect.fn('acquireOpencodeRuntime')(function* (
  deps: OpencodeAdapterDeps,
  input: { readonly threadId: ProviderSessionStartInput['threadId'] }
) {
  const settings = yield* deps.serverSettingsService.getSettings.pipe(
    Effect.mapError(
      error =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: input.threadId,
          detail: error.message,
          cause: error,
        })
    )
  )
  const binaryPath = settings.providers.opencode.binaryPath
  return yield* Effect.tryPromise({
    try: () => deps.createRuntime({ binaryPath }),
    catch: cause =>
      new ProviderAdapterProcessError({
        provider: PROVIDER,
        threadId: input.threadId,
        detail: toErrorMessage(cause, 'Failed to start opencode server.'),
        cause,
      }),
  })
})

const SHUTDOWN_THREAD_ID = 'opencode-shutdown'

const shutdownRuntimeIgnoring = (runtime: OpencodeClientRuntime): Effect.Effect<void> =>
  Effect.tryPromise({
    try: () => runtime.shutdown(),
    catch: cause =>
      new ProviderAdapterProcessError({
        provider: PROVIDER,
        threadId: SHUTDOWN_THREAD_ID,
        detail: toErrorMessage(cause, 'Failed to shut down opencode runtime.'),
        cause,
      }),
  }).pipe(Effect.ignore)

interface SdkCallInput {
  readonly runtime: OpencodeClientRuntime
  readonly threadId: ProviderSessionStartInput['threadId']
  readonly cwd: string | undefined
}

function callOpencodeSdk<A>(
  input: SdkCallInput,
  detailFallback: string,
  invoke: (args: {
    readonly client: OpencodeClientRuntime['client']
    readonly directory?: string
  }) => Promise<A>
): Effect.Effect<A, ProviderAdapterProcessError> {
  return Effect.tryPromise({
    try: () =>
      invoke({
        client: input.runtime.client,
        ...(input.cwd ? { directory: input.cwd } : {}),
      }),
    catch: cause =>
      new ProviderAdapterProcessError({
        provider: PROVIDER,
        threadId: input.threadId,
        detail: toErrorMessage(cause, detailFallback),
        cause,
      }),
  }).pipe(Effect.tapError(() => shutdownRuntimeIgnoring(input.runtime)))
}

const createSdkSession = (
  input: SdkCallInput
): Effect.Effect<Awaited<ReturnType<typeof createOpencodeSession>>, ProviderAdapterProcessError> =>
  callOpencodeSdk(input, 'Failed to create opencode SDK session.', createOpencodeSession)

const openEventStream = (
  input: SdkCallInput
): Effect.Effect<
  Awaited<ReturnType<typeof subscribeOpencodeEvents>>,
  ProviderAdapterProcessError
> => callOpencodeSdk(input, 'Failed to open opencode event stream.', subscribeOpencodeEvents)

function buildInitialContext(input: {
  readonly threadId: ProviderSessionStartInput['threadId']
  readonly runtimeMode: ProviderSessionStartInput['runtimeMode']
  readonly cwd: string | undefined
  readonly runtime: OpencodeClientRuntime
  readonly providerSessionId: string
  readonly startedAt: string
}): OpencodeSessionContext {
  const session: ProviderSession = {
    threadId: input.threadId,
    provider: PROVIDER,
    status: 'ready',
    providerSessionId: input.providerSessionId,
    runtimeMode: input.runtimeMode,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    createdAt: input.startedAt,
    updatedAt: input.startedAt,
  }
  return {
    session,
    runtime: input.runtime,
    providerSessionId: input.providerSessionId,
    currentModelId: undefined,
    currentProviderId: undefined,
    startedAt: input.startedAt,
    eventStreamFiber: undefined,
    turnState: undefined,
    lastKnownTokenUsage: undefined,
    relatedSessionIds: new Set([input.providerSessionId]),
    childDelegationsBySessionId: new Map(),
    pendingChildDelegations: [],
    stopped: false,
  }
}

const CONTEXT_PART_HINT_CACHES = new WeakMap<OpencodeSessionContext, PartHintCache>()

export function getPartHintCache(context: OpencodeSessionContext): PartHintCache {
  const cached = CONTEXT_PART_HINT_CACHES.get(context)
  if (cached) return cached
  const fresh = createPartHintCache()
  CONTEXT_PART_HINT_CACHES.set(context, fresh)
  return fresh
}

export function attachPartHintCache(context: OpencodeSessionContext, cache: PartHintCache): void {
  CONTEXT_PART_HINT_CACHES.set(context, cache)
}

export const stopSessionInternal = Effect.fn('opencode.stopSessionInternal')(function* (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  options?: { readonly emitExitEvent?: boolean }
) {
  if (context.stopped) return
  context.stopped = true

  const fiber = context.eventStreamFiber
  context.eventStreamFiber = undefined

  yield* abortOpencodeSessionIgnoring(context, 'Failed to abort opencode session during stop.')

  yield* shutdownRuntimeIgnoring(context.runtime)

  if (fiber && fiber.pollUnsafe() === undefined) {
    fiber.interruptUnsafe()
  }

  getPartHintCache(context).clear()
  context.relatedSessionIds.clear()
  context.childDelegationsBySessionId.clear()
  context.pendingChildDelegations.length = 0

  const updatedAt = yield* deps.nowIso
  context.session = {
    ...context.session,
    status: 'closed',
    activeTurnId: undefined,
    updatedAt,
  }

  if (options?.emitExitEvent !== false) {
    yield* emitSessionExitedEvent(deps, context, 'Session stopped', 'graceful')
  }

  deps.sessions.delete(context.session.threadId)
})

function buildCacheLookup(
  context: OpencodeSessionContext
): (
  event: Parameters<typeof readPartHintFromEvent>[0]
) => ReturnType<typeof readPartHintFromEvent> {
  return event => readPartHintFromEvent(event, getPartHintCache(context))
}

function attachStream(
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  stream: AsyncIterable<Parameters<typeof readPartHintFromEvent>[0]>,
  runFork: EventStreamRunFork
): void {
  attachEventStreamFiber({
    deps,
    context,
    stream,
    runFork,
    cacheLookup: buildCacheLookup(context),
    onExit: () => stopSessionInternal(deps, context, { emitExitEvent: true }),
  })
}

export const startSession = (
  deps: OpencodeAdapterDeps
): ((input: ProviderSessionStartInput) => Effect.Effect<ProviderSession, ProviderAdapterError>) =>
  Effect.fn('opencode.startSession')(function* (input) {
    yield* ensureSessionStartProviderMatches({
      provider: input.provider,
      expectedProvider: PROVIDER,
      operation: 'startSession',
    })

    const services = yield* Effect.services()
    const runFork = Effect.runForkWith(services)

    const startedAt = yield* deps.nowIso
    const runtime = yield* acquireOpencodeRuntime(deps, { threadId: input.threadId })
    const sdkSession = yield* createSdkSession({
      runtime,
      threadId: input.threadId,
      cwd: input.cwd,
    })
    const stream = yield* openEventStream({
      runtime,
      threadId: input.threadId,
      cwd: input.cwd,
    })

    const partHintCache = createPartHintCache()
    const context = buildInitialContext({
      threadId: input.threadId,
      runtimeMode: input.runtimeMode,
      cwd: input.cwd,
      runtime,
      providerSessionId: sdkSession.id,
      startedAt,
    })
    attachPartHintCache(context, partHintCache)
    deps.sessions.set(input.threadId, context)

    yield* emitSessionStartedEvent(deps, context, sdkSession.id)
    attachStream(deps, context, stream.stream, runFork)

    return { ...context.session }
  })
