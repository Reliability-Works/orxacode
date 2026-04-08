import { randomUUID } from 'node:crypto'

import {
  ApprovalRequestId,
  EventId,
  ProviderApprovalDecision,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderTurnStartResult,
  RuntimeSessionId,
  ThreadId,
  TurnId,
  type ProviderKind,
} from '@orxa-code/contracts'
import { Effect, Queue } from 'effect'

import {
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from '../src/provider/Errors.ts'
import type {
  ProviderAdapterShape,
  ProviderThreadSnapshot,
  ProviderThreadTurnSnapshot,
} from '../src/provider/Services/ProviderAdapter.ts'
import { createSessionControlHarness } from './TestProviderAdapter.integration.controls.ts'
import { normalizeFixtureEvent } from './TestProviderAdapter.integration.normalization.ts'

export interface TestTurnResponse {
  readonly events: ReadonlyArray<FixtureProviderRuntimeEvent>
  readonly mutateWorkspace?: (input: {
    readonly cwd: string
    readonly turnCount: number
  }) => Effect.Effect<void, never>
}

export type FixtureProviderRuntimeEvent = {
  readonly type: string
  readonly eventId: EventId
  readonly provider: ProviderKind
  readonly createdAt: string
  readonly threadId: string
  readonly turnId?: string | undefined
  readonly itemId?: string | undefined
  readonly requestId?: string | undefined
  readonly payload?: unknown | undefined
  readonly [key: string]: unknown
}

export type LegacyProviderRuntimeEvent = FixtureProviderRuntimeEvent

export interface TestProviderAdapterHarness {
  readonly adapter: ProviderAdapterShape<ProviderAdapterError>
  readonly provider: ProviderKind
  readonly queueTurnResponse: (
    threadId: ThreadId,
    response: TestTurnResponse
  ) => Effect.Effect<void, ProviderAdapterSessionNotFoundError>
  readonly queueTurnResponseForNextSession: (
    response: TestTurnResponse
  ) => Effect.Effect<void, never>
  readonly getStartCount: () => number
  readonly getRollbackCalls: (threadId: ThreadId) => ReadonlyArray<number>
  readonly getInterruptCalls: (threadId: ThreadId) => ReadonlyArray<TurnId | undefined>
  readonly listActiveSessionIds: () => ReadonlyArray<ThreadId>
  readonly getApprovalResponses: (threadId: ThreadId) => ReadonlyArray<{
    readonly threadId: ThreadId
    readonly requestId: ApprovalRequestId
    readonly decision: ProviderApprovalDecision
  }>
}

export interface SessionState {
  readonly session: ProviderSession
  snapshot: ProviderThreadSnapshot
  turnCount: number
  readonly queuedResponses: Array<TestTurnResponse>
  readonly rollbackCalls: Array<number>
}

function nowIso(): string {
  return new Date().toISOString()
}

function sessionNotFound(
  provider: ProviderKind,
  threadId: ThreadId
): ProviderAdapterSessionNotFoundError {
  return new ProviderAdapterSessionNotFoundError({
    provider,
    threadId: String(threadId),
  })
}

export function missingSessionEffect(
  provider: ProviderKind,
  threadId: ThreadId
): Effect.Effect<never, ProviderAdapterError> {
  return Effect.fail(sessionNotFound(provider, threadId))
}

function collectAssistantDelta(
  runtimeEvent: ProviderRuntimeEvent,
  assistantDeltas: string[]
): void {
  const runtimeType = (runtimeEvent as { type: string }).type
  if (runtimeType === 'content.delta') {
    const payload = runtimeEvent.payload as { delta?: unknown } | undefined
    if (typeof payload?.delta === 'string') {
      assistantDeltas.push(payload.delta)
    }
    return
  }

  if (runtimeType === 'message.delta') {
    const legacyDelta = (runtimeEvent as { delta?: unknown }).delta
    if (typeof legacyDelta === 'string') {
      assistantDeltas.push(legacyDelta)
    }
  }
}

function createRawFixtureEvent(input: {
  readonly fixtureEvent: FixtureProviderRuntimeEvent
  readonly provider: ProviderKind
  readonly threadId: ThreadId
  readonly stateThreadId: ThreadId
  readonly turnId: TurnId
}): Record<string, unknown> {
  const rawEvent: Record<string, unknown> = {
    ...(input.fixtureEvent as Record<string, unknown>),
    eventId: randomUUID(),
    provider: input.provider,
    sessionId: RuntimeSessionId.makeUnsafe(String(input.threadId)),
    createdAt: nowIso(),
  }
  rawEvent.threadId = input.stateThreadId
  if (Object.hasOwn(rawEvent, 'turnId')) {
    rawEvent.turnId = input.turnId
  }
  return rawEvent
}

function createTurnSnapshot(input: {
  readonly inputText: string
  readonly assistantText: string
  readonly turnId: TurnId
}) {
  const userItem = {
    type: 'userMessage',
    content: [{ type: 'text', text: input.inputText }],
  } as const
  const items: Array<unknown> =
    input.assistantText.length > 0
      ? [userItem, { type: 'agentMessage', text: input.assistantText }]
      : [userItem]

  return {
    id: input.turnId,
    items,
  } satisfies ProviderThreadTurnSnapshot
}

function requireQueuedResponse(input: {
  readonly provider: ProviderKind
  readonly threadId: ThreadId
  readonly response: TestTurnResponse | undefined
}): Effect.Effect<TestTurnResponse, ProviderAdapterValidationError> {
  return input.response
    ? Effect.succeed(input.response)
    : Effect.fail(
        new ProviderAdapterValidationError({
          provider: input.provider,
          operation: 'sendTurn',
          issue: `No queued turn response for thread ${input.threadId}.`,
        })
      )
}

const createStartSessionHandler =
  (input: {
    readonly provider: ProviderKind
    readonly sessions: Map<ThreadId, SessionState>
    readonly queuedResponsesForNextSession: TestTurnResponse[]
    readonly incrementSessionCount: () => number
  }): ProviderAdapterShape<ProviderAdapterError>['startSession'] =>
  startInput =>
    Effect.gen(function* () {
      if (startInput.provider !== undefined && startInput.provider !== input.provider) {
        return yield* new ProviderAdapterValidationError({
          provider: input.provider,
          operation: 'startSession',
          issue: `Expected provider '${input.provider}' but received '${startInput.provider}'.`,
        })
      }

      const sessionCount = input.incrementSessionCount()
      const threadId = startInput.threadId
      const createdAt = nowIso()
      const session: ProviderSession = {
        provider: input.provider,
        status: 'ready',
        runtimeMode: startInput.runtimeMode,
        threadId,
        cwd: startInput.cwd,
        resumeCursor: startInput.resumeCursor ?? { threadId: String(threadId), seed: sessionCount },
        createdAt,
        updatedAt: createdAt,
      }

      input.sessions.set(threadId, {
        session,
        snapshot: {
          threadId,
          turns: [],
        },
        turnCount: 0,
        queuedResponses: input.queuedResponsesForNextSession.splice(0),
        rollbackCalls: [],
      })

      return session
    })

const createSendTurnHandler =
  (input: {
    readonly provider: ProviderKind
    readonly sessions: Map<ThreadId, SessionState>
    readonly emit: (event: ProviderRuntimeEvent) => Effect.Effect<void>
  }): ProviderAdapterShape<ProviderAdapterError>['sendTurn'] =>
  turnInput =>
    Effect.gen(function* () {
      const state = input.sessions.get(turnInput.threadId)
      if (!state) {
        return yield* missingSessionEffect(input.provider, turnInput.threadId)
      }

      state.turnCount += 1
      const turnCount = state.turnCount
      const turnId = TurnId.makeUnsafe(`turn-${turnCount}`)
      const response = yield* requireQueuedResponse({
        provider: input.provider,
        threadId: turnInput.threadId,
        response: state.queuedResponses.shift(),
      })

      const assistantDeltas: string[] = []
      const deferredTurnCompletedEvents: ProviderRuntimeEvent[] = []
      for (const fixtureEvent of response.events) {
        const runtimeEvent = normalizeFixtureEvent(
          createRawFixtureEvent({
            fixtureEvent,
            provider: input.provider,
            threadId: turnInput.threadId,
            stateThreadId: state.snapshot.threadId,
            turnId,
          })
        )
        collectAssistantDelta(runtimeEvent, assistantDeltas)
        if (runtimeEvent.type === 'turn.completed') {
          deferredTurnCompletedEvents.push(runtimeEvent)
          continue
        }
        yield* input.emit(runtimeEvent)
      }

      if (response.mutateWorkspace && state.session.cwd) {
        yield* response.mutateWorkspace({ cwd: state.session.cwd, turnCount })
      }

      state.snapshot = {
        threadId: state.snapshot.threadId,
        turns: [
          ...state.snapshot.turns,
          createTurnSnapshot({
            inputText: typeof turnInput.input === 'string' ? turnInput.input : '',
            assistantText: assistantDeltas.join(''),
            turnId,
          }),
        ],
      }

      if (deferredTurnCompletedEvents.length === 0) {
        yield* input.emit({
          type: 'turn.completed',
          eventId: EventId.makeUnsafe(randomUUID()),
          provider: input.provider,
          createdAt: nowIso(),
          threadId: state.snapshot.threadId,
          turnId,
          payload: {
            state: 'completed',
          },
        })
      } else {
        for (const completedEvent of deferredTurnCompletedEvents) {
          yield* input.emit(completedEvent)
        }
      }

      return {
        threadId: state.snapshot.threadId,
        turnId,
      } satisfies ProviderTurnStartResult
    })

type HarnessState = {
  sessionCountRef: { current: number }
  sessions: Map<ThreadId, SessionState>
  queuedResponsesForNextSession: TestTurnResponse[]
  interruptCallsBySession: Map<ThreadId, Array<TurnId | undefined>>
  approvalResponsesBySession: Map<
    ThreadId,
    Array<{
      readonly threadId: ThreadId
      readonly requestId: ApprovalRequestId
      readonly decision: ProviderApprovalDecision
    }>
  >
}

function createHarnessState(): HarnessState {
  return {
    sessionCountRef: { current: 0 },
    sessions: new Map<ThreadId, SessionState>(),
    queuedResponsesForNextSession: [],
    interruptCallsBySession: new Map<ThreadId, Array<TurnId | undefined>>(),
    approvalResponsesBySession: new Map(),
  }
}

export function createTestProviderAdapterHarness(
  provider: ProviderKind,
  runtimeEvents: Queue.Queue<ProviderRuntimeEvent>
): TestProviderAdapterHarness {
  const state = createHarnessState()
  const emit = (event: ProviderRuntimeEvent) => Queue.offer(runtimeEvents, event)
  const startSession = createStartSessionHandler({
    provider,
    sessions: state.sessions,
    queuedResponsesForNextSession: state.queuedResponsesForNextSession,
    incrementSessionCount: () => {
      state.sessionCountRef.current += 1
      return state.sessionCountRef.current
    },
  })
  const sendTurn = createSendTurnHandler({ provider, sessions: state.sessions, emit })
  const sessionControl = createSessionControlHarness({
    provider,
    sessions: state.sessions,
    interruptCallsBySession: state.interruptCallsBySession,
    approvalResponsesBySession: state.approvalResponsesBySession,
    runtimeEvents,
  })

  const queueTurnResponseForNextSession = (
    response: TestTurnResponse
  ): Effect.Effect<void, never> =>
    Effect.sync(() => {
      state.queuedResponsesForNextSession.push(response)
    })

  return {
    adapter: createAdapter({ provider, startSession, sendTurn, ...sessionControl }),
    provider,
    queueTurnResponse: createQueueTurnResponse({ provider, sessions: state.sessions }),
    queueTurnResponseForNextSession,
    getStartCount: () => state.sessionCountRef.current,
    getRollbackCalls: (threadId: ThreadId): ReadonlyArray<number> =>
      state.sessions.get(threadId)?.rollbackCalls
        ? [...state.sessions.get(threadId)!.rollbackCalls]
        : [],
    getInterruptCalls: sessionControl.getInterruptCalls,
    listActiveSessionIds: sessionControl.listActiveSessionIds,
    getApprovalResponses: sessionControl.getApprovalResponses,
  } satisfies TestProviderAdapterHarness
}

function createAdapter(input: {
  readonly provider: ProviderKind
  readonly startSession: ProviderAdapterShape<ProviderAdapterError>['startSession']
  readonly sendTurn: ProviderAdapterShape<ProviderAdapterError>['sendTurn']
  readonly interruptTurn: ProviderAdapterShape<ProviderAdapterError>['interruptTurn']
  readonly respondToRequest: ProviderAdapterShape<ProviderAdapterError>['respondToRequest']
  readonly respondToUserInput: ProviderAdapterShape<ProviderAdapterError>['respondToUserInput']
  readonly stopSession: ProviderAdapterShape<ProviderAdapterError>['stopSession']
  readonly listSessions: ProviderAdapterShape<ProviderAdapterError>['listSessions']
  readonly hasSession: ProviderAdapterShape<ProviderAdapterError>['hasSession']
  readonly readThread: ProviderAdapterShape<ProviderAdapterError>['readThread']
  readonly rollbackThread: ProviderAdapterShape<ProviderAdapterError>['rollbackThread']
  readonly stopAll: ProviderAdapterShape<ProviderAdapterError>['stopAll']
  readonly streamEvents: ProviderAdapterShape<ProviderAdapterError>['streamEvents']
}): ProviderAdapterShape<ProviderAdapterError> {
  return {
    provider: input.provider,
    capabilities: {
      sessionModelSwitch: 'in-session',
    },
    startSession: input.startSession,
    sendTurn: input.sendTurn,
    interruptTurn: input.interruptTurn,
    respondToRequest: input.respondToRequest,
    respondToUserInput: input.respondToUserInput,
    stopSession: input.stopSession,
    listSessions: input.listSessions,
    hasSession: input.hasSession,
    readThread: input.readThread,
    rollbackThread: input.rollbackThread,
    stopAll: input.stopAll,
    streamEvents: input.streamEvents,
  }
}

function createQueueTurnResponse(input: {
  readonly provider: ProviderKind
  readonly sessions: Map<ThreadId, SessionState>
}) {
  return (
    threadId: ThreadId,
    response: TestTurnResponse
  ): Effect.Effect<void, ProviderAdapterSessionNotFoundError> =>
    Effect.sync(() => input.sessions.get(threadId)).pipe(
      Effect.flatMap(state =>
        state
          ? Effect.sync(() => {
              state.queuedResponses.push(response)
            })
          : Effect.fail(sessionNotFound(input.provider, threadId))
      )
    )
}
