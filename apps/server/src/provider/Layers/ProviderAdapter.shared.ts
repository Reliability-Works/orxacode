import {
  EventId,
  type ProviderRuntimeEvent,
  type ProviderRuntimeSessionExitedEvent,
  type ServerProvider,
  ThreadId,
} from '@orxa-code/contracts'
import { DateTime, Effect, Queue, Random } from 'effect'

import {
  ProviderAdapterRequestError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from '../Errors.ts'

type ProviderName = ServerProvider['provider']

export function makeRequestError(input: {
  provider: string
  threadId: ThreadId
  method: string
  cause: unknown
  toMessage: (cause: unknown, fallback: string) => string
  toSessionError: (threadId: ThreadId, cause: unknown) => ProviderAdapterError | undefined
}): ProviderAdapterError {
  const sessionError = input.toSessionError(input.threadId, input.cause)
  if (sessionError) {
    return sessionError
  }
  return new ProviderAdapterRequestError({
    provider: input.provider,
    method: input.method,
    detail: input.toMessage(input.cause, `${input.method} failed`),
    cause: input.cause,
  })
}

/**
 * Standard event-stamp + queue dependency surface shared by every provider
 * adapter helper module. Both `ClaudeAdapterDeps` and `OpencodeAdapterDeps`
 * extend this shape; the runtime helpers can therefore consume the shared
 * helpers below without caring which provider they belong to.
 */
export interface ProviderAdapterEventStamping {
  readonly nowIso: Effect.Effect<string>
  readonly nextEventId: Effect.Effect<EventId>
  readonly makeEventStamp: () => Effect.Effect<{
    readonly eventId: EventId
    readonly createdAt: string
  }>
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>
}

/**
 * Build the standard event-stamping helpers (clock, id generator, event stamp,
 * queue offer) from a runtime event queue. Both Claude and Opencode adapter
 * deps factories use this so they don't redeclare the same boilerplate.
 */
export function makeProviderAdapterEventStamping(
  runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>
): ProviderAdapterEventStamping {
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso)
  const nextEventId = Effect.map(Random.nextUUIDv4, id => EventId.makeUnsafe(id))
  const makeEventStamp = (): Effect.Effect<{
    readonly eventId: EventId
    readonly createdAt: string
  }> => Effect.all({ eventId: nextEventId, createdAt: nowIso })
  const offerRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid)
  return {
    nowIso,
    nextEventId,
    makeEventStamp,
    offerRuntimeEvent,
  }
}

export interface EmitProviderSessionExitedInput {
  readonly provider: ProviderName
  readonly threadId: ThreadId
  readonly reason: string
  readonly exitKind: 'graceful' | 'error'
}

/**
 * Emit a canonical `session.exited` runtime event for the given provider and
 * thread. Used by both Claude and Opencode adapters to keep the wire format
 * consistent and avoid jscpd duplication of the event literal.
 */
export const emitProviderSessionExitedEvent = Effect.fn('emitProviderSessionExitedEvent')(
  function* (deps: ProviderAdapterEventStamping, input: EmitProviderSessionExitedInput) {
    const stamp = yield* deps.makeEventStamp()
    const event: ProviderRuntimeSessionExitedEvent = {
      type: 'session.exited',
      eventId: stamp.eventId,
      provider: input.provider,
      createdAt: stamp.createdAt,
      threadId: input.threadId,
      payload: {
        reason: input.reason,
        exitKind: input.exitKind,
      },
      providerRefs: {},
    }
    yield* deps.offerRuntimeEvent(event)
  }
)

/**
 * Validate that the optional `provider` field on a session-start input either
 * matches the adapter's expected provider or is omitted entirely. Both Claude
 * and Opencode `startSession` helpers use this to keep the validation block in
 * one place.
 */
export interface AdapterShapeMethods<
  StartSession,
  SendTurn,
  InterruptTurn,
  ReadThread,
  RollbackThread,
  RespondToRequest,
  RespondToUserInput,
  StopSession,
  ListSessions,
  HasSession,
  StopAll,
  StreamEvents,
> {
  readonly startSession: StartSession
  readonly sendTurn: SendTurn
  readonly interruptTurn: InterruptTurn
  readonly readThread: ReadThread
  readonly rollbackThread: RollbackThread
  readonly respondToRequest: RespondToRequest
  readonly respondToUserInput: RespondToUserInput
  readonly stopSession: StopSession
  readonly listSessions: ListSessions
  readonly hasSession: HasSession
  readonly stopAll: StopAll
  readonly streamEvents: StreamEvents
}

/**
 * Assemble a provider adapter's `Shape` record from its method bindings. Both
 * Claude and Opencode adapter wiring shells call this so the long flat record
 * literal lives in one place and jscpd does not flag it as a duplicate.
 */
export function assembleProviderAdapterShape<
  Provider extends ProviderName,
  Capabilities,
  StartSession,
  SendTurn,
  InterruptTurn,
  ReadThread,
  RollbackThread,
  RespondToRequest,
  RespondToUserInput,
  StopSession,
  ListSessions,
  HasSession,
  StopAll,
  StreamEvents,
>(input: {
  readonly provider: Provider
  readonly capabilities: Capabilities
  readonly methods: AdapterShapeMethods<
    StartSession,
    SendTurn,
    InterruptTurn,
    ReadThread,
    RollbackThread,
    RespondToRequest,
    RespondToUserInput,
    StopSession,
    ListSessions,
    HasSession,
    StopAll,
    StreamEvents
  >
}): {
  readonly provider: Provider
  readonly capabilities: Capabilities
} & AdapterShapeMethods<
  StartSession,
  SendTurn,
  InterruptTurn,
  ReadThread,
  RollbackThread,
  RespondToRequest,
  RespondToUserInput,
  StopSession,
  ListSessions,
  HasSession,
  StopAll,
  StreamEvents
> {
  return {
    provider: input.provider,
    capabilities: input.capabilities,
    ...input.methods,
  }
}

/**
 * Build the standard adapter teardown finalizer effect: stop every live
 * session in the map (with `emitExitEvent: false`) then shut down the runtime
 * event queue. Both Claude and Opencode adapter wiring shells use this so the
 * finalizer assembly does not duplicate between them.
 */
export const buildAdapterCleanupFinalizer = <Session>(input: {
  readonly sessions: Map<ThreadId, Session>
  readonly runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>
  readonly stopSession: (session: Session) => Effect.Effect<void>
}): Effect.Effect<void> =>
  Effect.forEach(input.sessions, ([, session]) => input.stopSession(session), {
    discard: true,
  }).pipe(Effect.tap(() => Queue.shutdown(input.runtimeEventQueue)))

export function ensureSessionStartProviderMatches(input: {
  readonly provider: ProviderName | undefined
  readonly expectedProvider: ProviderName
  readonly operation: string
}): Effect.Effect<void, ProviderAdapterValidationError> {
  if (input.provider !== undefined && input.provider !== input.expectedProvider) {
    return Effect.fail(
      new ProviderAdapterValidationError({
        provider: input.expectedProvider,
        operation: input.operation,
        issue: `Expected provider '${input.expectedProvider}' but received '${input.provider}'.`,
      })
    )
  }
  return Effect.void
}
