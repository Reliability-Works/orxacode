import {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderRuntimeEvent,
  ThreadId,
  TurnId,
  type ProviderKind,
} from '@orxa-code/contracts'
import { Effect, Queue, Stream } from 'effect'

import {
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from '../src/provider/Errors.ts'
import type { ProviderAdapterShape } from '../src/provider/Services/ProviderAdapter.ts'
import type { SessionState } from './TestProviderAdapter.integration.helpers.ts'

function missingSessionEffect(
  provider: ProviderKind,
  threadId: ThreadId
): Effect.Effect<never, ProviderAdapterError> {
  return Effect.fail(
    new ProviderAdapterSessionNotFoundError({
      provider,
      threadId: String(threadId),
    })
  )
}

export function createSessionControlHarness(input: {
  readonly provider: ProviderKind
  readonly sessions: Map<ThreadId, SessionState>
  readonly interruptCallsBySession: Map<ThreadId, Array<TurnId | undefined>>
  readonly approvalResponsesBySession: Map<
    ThreadId,
    Array<{
      readonly threadId: ThreadId
      readonly requestId: ApprovalRequestId
      readonly decision: ProviderApprovalDecision
    }>
  >
  readonly runtimeEvents: Queue.Queue<ProviderRuntimeEvent>
}) {
  const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>['respondToUserInput'] =
    threadId =>
      input.sessions.has(threadId) ? Effect.void : missingSessionEffect(input.provider, threadId)

  const stopSession: ProviderAdapterShape<ProviderAdapterError>['stopSession'] = threadId =>
    Effect.sync(() => {
      input.sessions.delete(threadId)
    })

  const listSessions: ProviderAdapterShape<ProviderAdapterError>['listSessions'] = () =>
    Effect.sync(() => Array.from(input.sessions.values(), state => state.session))

  const hasSession: ProviderAdapterShape<ProviderAdapterError>['hasSession'] = threadId =>
    Effect.succeed(input.sessions.has(threadId))

  const readThread: ProviderAdapterShape<ProviderAdapterError>['readThread'] = threadId => {
    const state = input.sessions.get(threadId)
    return state ? Effect.succeed(state.snapshot) : missingSessionEffect(input.provider, threadId)
  }

  const stopAll: ProviderAdapterShape<ProviderAdapterError>['stopAll'] = () =>
    Effect.sync(() => {
      input.sessions.clear()
    })
  const inspectors = createHarnessInspectors(input)

  return {
    interruptTurn: createInterruptTurnHandler(input),
    respondToRequest: createRespondToRequestHandler(input),
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread: createRollbackThreadHandler(input),
    stopAll,
    ...inspectors,
    streamEvents: Stream.fromQueue(input.runtimeEvents),
  }
}

function createInterruptTurnHandler(input: {
  readonly provider: ProviderKind
  readonly sessions: Map<ThreadId, SessionState>
  readonly interruptCallsBySession: Map<ThreadId, Array<TurnId | undefined>>
}): ProviderAdapterShape<ProviderAdapterError>['interruptTurn'] {
  return (threadId, turnId) =>
    input.sessions.has(threadId)
      ? Effect.sync(() => {
          const existing = input.interruptCallsBySession.get(threadId) ?? []
          existing.push(turnId)
          input.interruptCallsBySession.set(threadId, existing)
        })
      : missingSessionEffect(input.provider, threadId)
}

function createRespondToRequestHandler(input: {
  readonly provider: ProviderKind
  readonly sessions: Map<ThreadId, SessionState>
  readonly approvalResponsesBySession: Map<
    ThreadId,
    Array<{
      readonly threadId: ThreadId
      readonly requestId: ApprovalRequestId
      readonly decision: ProviderApprovalDecision
    }>
  >
}): ProviderAdapterShape<ProviderAdapterError>['respondToRequest'] {
  return (threadId, requestId, decision) =>
    input.sessions.has(threadId)
      ? Effect.sync(() => {
          const existing = input.approvalResponsesBySession.get(threadId) ?? []
          existing.push({ threadId, requestId, decision })
          input.approvalResponsesBySession.set(threadId, existing)
        })
      : missingSessionEffect(input.provider, threadId)
}

function createRollbackThreadHandler(input: {
  readonly provider: ProviderKind
  readonly sessions: Map<ThreadId, SessionState>
}): ProviderAdapterShape<ProviderAdapterError>['rollbackThread'] {
  return (threadId, numTurns) => {
    const state = input.sessions.get(threadId)
    if (!state) {
      return missingSessionEffect(input.provider, threadId)
    }
    if (!Number.isInteger(numTurns) || numTurns < 0 || numTurns > state.snapshot.turns.length) {
      return Effect.fail(
        new ProviderAdapterValidationError({
          provider: input.provider,
          operation: 'rollbackThread',
          issue: 'numTurns must be an integer between 0 and current turn count.',
        })
      )
    }

    return Effect.sync(() => {
      state.rollbackCalls.push(numTurns)
      state.snapshot = {
        threadId: state.snapshot.threadId,
        turns: state.snapshot.turns.slice(0, state.snapshot.turns.length - numTurns),
      }
      state.turnCount = state.snapshot.turns.length
      return state.snapshot
    })
  }
}

function createHarnessInspectors(input: {
  readonly sessions: Map<ThreadId, SessionState>
  readonly interruptCallsBySession: Map<ThreadId, Array<TurnId | undefined>>
  readonly approvalResponsesBySession: Map<
    ThreadId,
    Array<{
      readonly threadId: ThreadId
      readonly requestId: ApprovalRequestId
      readonly decision: ProviderApprovalDecision
    }>
  >
}) {
  return {
    listActiveSessionIds: (): ReadonlyArray<ThreadId> =>
      Array.from(input.sessions.values(), state => state.session.threadId),
    getInterruptCalls: (threadId: ThreadId): ReadonlyArray<TurnId | undefined> => {
      const calls = input.interruptCallsBySession.get(threadId)
      return calls ? [...calls] : []
    },
    getApprovalResponses: (
      threadId: ThreadId
    ): ReadonlyArray<{
      readonly threadId: ThreadId
      readonly requestId: ApprovalRequestId
      readonly decision: ProviderApprovalDecision
    }> => {
      const responses = input.approvalResponsesBySession.get(threadId)
      return responses ? [...responses] : []
    },
  }
}
