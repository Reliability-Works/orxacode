import { Effect, Option, SynchronizedRef } from 'effect'

import { TerminalCwdError, TerminalSessionLookupError } from '../Services/Manager'

import type { TerminalManagerDeps } from './Manager.deps'
import { normalizedRuntimeEnv, toSessionKey } from './Manager.pure'
import { persistHistory } from './Manager.persist'
import {
  type TerminalManagerState,
  type TerminalSessionState,
  type TerminalStartInput,
} from './Manager.types'

export const readManagerState = (deps: TerminalManagerDeps) =>
  SynchronizedRef.get(deps.managerStateRef)

export const modifyManagerState = <A>(
  deps: TerminalManagerDeps,
  f: (state: TerminalManagerState) => readonly [A, TerminalManagerState]
) => SynchronizedRef.modify(deps.managerStateRef, f)

export const assertValidCwd = Effect.fn('terminal.assertValidCwd')(function* (
  deps: TerminalManagerDeps,
  cwd: string
) {
  const stats = yield* deps.fileSystem.stat(cwd).pipe(
    Effect.mapError(
      cause =>
        new TerminalCwdError({
          cwd,
          reason: cause.reason._tag === 'NotFound' ? 'notFound' : 'statFailed',
          cause,
        })
    )
  )
  if (stats.type !== 'Directory') {
    return yield* new TerminalCwdError({
      cwd,
      reason: 'notDirectory',
    })
  }
})

export const getSession = Effect.fn('terminal.getSession')(function* (
  deps: TerminalManagerDeps,
  threadId: string,
  terminalId: string
): Effect.fn.Return<Option.Option<TerminalSessionState>> {
  return yield* Effect.map(readManagerState(deps), state =>
    Option.fromNullishOr(state.sessions.get(toSessionKey(threadId, terminalId)))
  )
})

export const requireSession = Effect.fn('terminal.requireSession')(function* (
  deps: TerminalManagerDeps,
  threadId: string,
  terminalId: string
): Effect.fn.Return<TerminalSessionState, TerminalSessionLookupError> {
  return yield* Effect.flatMap(getSession(deps, threadId, terminalId), session =>
    Option.match(session, {
      onNone: () =>
        Effect.fail(
          new TerminalSessionLookupError({
            threadId,
            terminalId,
          })
        ),
      onSome: Effect.succeed,
    })
  )
})

export const sessionsForThread = Effect.fn('terminal.sessionsForThread')(function* (
  deps: TerminalManagerDeps,
  threadId: string
) {
  return yield* readManagerState(deps).pipe(
    Effect.map(state =>
      [...state.sessions.values()].filter(session => session.threadId === threadId)
    )
  )
})

export const evictInactiveSessionsIfNeeded = Effect.fn('terminal.evictInactiveSessionsIfNeeded')(
  function* (deps: TerminalManagerDeps) {
    yield* modifyManagerState(deps, state => {
      const inactiveSessions = [...state.sessions.values()].filter(
        session => session.status !== 'running'
      )
      if (inactiveSessions.length <= deps.maxRetainedInactiveSessions) {
        return [undefined, state] as const
      }

      inactiveSessions.sort(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) ||
          left.threadId.localeCompare(right.threadId) ||
          left.terminalId.localeCompare(right.terminalId)
      )

      const sessions = new Map(state.sessions)

      const toEvict = inactiveSessions.length - deps.maxRetainedInactiveSessions
      for (const session of inactiveSessions.slice(0, toEvict)) {
        const key = toSessionKey(session.threadId, session.terminalId)
        sessions.delete(key)
      }

      return [undefined, { ...state, sessions }] as const
    })
  }
)

export const clearSessionProcessQueue = (
  session: TerminalSessionState,
  options?: { resetPendingHistoryControlSequence?: boolean }
): void => {
  if (options?.resetPendingHistoryControlSequence) {
    session.pendingHistoryControlSequence = ''
  }
  session.pendingProcessEvents = []
  session.pendingProcessEventIndex = 0
  session.processEventDrainRunning = false
}

export const createTerminalSessionState = (input: TerminalStartInput): TerminalSessionState => ({
  threadId: input.threadId,
  terminalId: input.terminalId,
  cwd: input.cwd,
  status: 'starting',
  pid: null,
  history: '',
  pendingHistoryControlSequence: '',
  pendingProcessEvents: [],
  pendingProcessEventIndex: 0,
  processEventDrainRunning: false,
  exitCode: null,
  exitSignal: null,
  updatedAt: new Date().toISOString(),
  cols: input.cols,
  rows: input.rows,
  process: null,
  unsubscribeData: null,
  unsubscribeExit: null,
  hasRunningSubprocess: false,
  runtimeEnv: normalizedRuntimeEnv(input.env),
})

export const resetSessionHistory = Effect.fn('terminal.resetSessionHistory')(function* (
  deps: TerminalManagerDeps,
  session: TerminalSessionState
) {
  session.history = ''
  clearSessionProcessQueue(session, { resetPendingHistoryControlSequence: true })
  yield* persistHistory(deps, session.threadId, session.terminalId, session.history)
})
