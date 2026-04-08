import { DEFAULT_TERMINAL_ID } from '@orxa-code/contracts'
import { Effect, Option, Semaphore, SynchronizedRef } from 'effect'

import { TerminalNotRunningError, type TerminalManagerShape } from '../Services/Manager'

import { publishEvent } from './Manager.drain'
import type { TerminalManagerDeps } from './Manager.deps'
import {
  closeAllSessionsForThread,
  closeSession,
  openExistingSession,
  openNewSession,
  startSession,
  stopProcess,
} from './Manager.lifecycle'
import { persistHistory } from './Manager.persist'
import { normalizedRuntimeEnv, snapshot, toSessionKey } from './Manager.pure'
import {
  assertValidCwd,
  createTerminalSessionState,
  evictInactiveSessionsIfNeeded,
  getSession,
  modifyManagerState,
  requireSession,
} from './Manager.sessionState'
import { DEFAULT_OPEN_COLS, DEFAULT_OPEN_ROWS, type TerminalSessionState } from './Manager.types'

const getThreadSemaphore = (deps: TerminalManagerDeps, threadId: string) =>
  SynchronizedRef.modifyEffect(deps.threadLocksRef, current => {
    const existing: Option.Option<Semaphore.Semaphore> = Option.fromNullishOr(current.get(threadId))
    return Option.match(existing, {
      onNone: () =>
        Semaphore.make(1).pipe(
          Effect.map(semaphore => {
            const next = new Map(current)
            next.set(threadId, semaphore)
            return [semaphore, next] as const
          })
        ),
      onSome: semaphore => Effect.succeed([semaphore, current] as const),
    })
  })

const withThreadLock = <A, E, R>(
  deps: TerminalManagerDeps,
  threadId: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.flatMap(getThreadSemaphore(deps, threadId), semaphore => semaphore.withPermit(effect))

function buildOpen(deps: TerminalManagerDeps): TerminalManagerShape['open'] {
  return input =>
    withThreadLock(
      deps,
      input.threadId,
      Effect.gen(function* () {
        const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID
        yield* assertValidCwd(deps, input.cwd)
        const targetCols = input.cols ?? DEFAULT_OPEN_COLS
        const targetRows = input.rows ?? DEFAULT_OPEN_ROWS
        const terminalStartInput = {
          threadId: input.threadId,
          terminalId,
          cwd: input.cwd,
          cols: targetCols,
          rows: targetRows,
          ...(input.env ? { env: input.env } : {}),
        }
        const sessionKey = toSessionKey(input.threadId, terminalId)
        const existing = yield* getSession(deps, input.threadId, terminalId)
        if (Option.isNone(existing)) {
          return yield* openNewSession(deps, terminalStartInput, sessionKey)
        }
        return yield* openExistingSession(deps, existing.value, terminalStartInput)
      })
    )
}

type RunningSessionGate =
  | { kind: 'process'; process: NonNullable<TerminalSessionState['process']> }
  | { kind: 'skip' }
  | { kind: 'notRunning' }

function gateRunningProcess(session: TerminalSessionState): RunningSessionGate {
  if (session.process && session.status === 'running') {
    return { kind: 'process', process: session.process }
  }
  if (session.status === 'exited') return { kind: 'skip' }
  return { kind: 'notRunning' }
}

function buildWrite(deps: TerminalManagerDeps): TerminalManagerShape['write'] {
  return Effect.fn('terminal.write')(function* (input) {
    const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID
    const session = yield* requireSession(deps, input.threadId, terminalId)
    const gate = gateRunningProcess(session)
    if (gate.kind === 'skip') return
    if (gate.kind === 'notRunning') {
      return yield* new TerminalNotRunningError({ threadId: input.threadId, terminalId })
    }
    const proc = gate.process
    yield* Effect.sync(() => proc.write(input.data))
  })
}

function buildResize(deps: TerminalManagerDeps): TerminalManagerShape['resize'] {
  return Effect.fn('terminal.resize')(function* (input) {
    const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID
    const session = yield* requireSession(deps, input.threadId, terminalId)
    const gate = gateRunningProcess(session)
    if (gate.kind !== 'process') {
      return yield* new TerminalNotRunningError({ threadId: input.threadId, terminalId })
    }
    const proc = gate.process
    session.cols = input.cols
    session.rows = input.rows
    session.updatedAt = new Date().toISOString()
    yield* Effect.sync(() => proc.resize(input.cols, input.rows))
  })
}

function buildClear(deps: TerminalManagerDeps): TerminalManagerShape['clear'] {
  return input =>
    withThreadLock(
      deps,
      input.threadId,
      Effect.gen(function* () {
        const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID
        const session = yield* requireSession(deps, input.threadId, terminalId)
        session.history = ''
        session.pendingHistoryControlSequence = ''
        session.pendingProcessEvents = []
        session.pendingProcessEventIndex = 0
        session.processEventDrainRunning = false
        session.updatedAt = new Date().toISOString()
        yield* persistHistory(deps, input.threadId, terminalId, session.history)
        yield* publishEvent(deps, {
          type: 'cleared',
          threadId: input.threadId,
          terminalId,
          createdAt: new Date().toISOString(),
        })
      })
    )
}

function createOrReuseRestartSession(
  deps: TerminalManagerDeps,
  input: Parameters<TerminalManagerShape['restart']>[0],
  existingSession: Option.Option<TerminalSessionState>,
  sessionKey: string
) {
  return Effect.gen(function* () {
    if (Option.isSome(existingSession)) {
      const session = existingSession.value
      yield* stopProcess(deps, session)
      session.cwd = input.cwd
      session.runtimeEnv = normalizedRuntimeEnv(input.env)
      return session
    }

    const cols = input.cols ?? DEFAULT_OPEN_COLS
    const rows = input.rows ?? DEFAULT_OPEN_ROWS
    const created: TerminalSessionState = createTerminalSessionState({
      threadId: input.threadId,
      terminalId: input.terminalId ?? DEFAULT_TERMINAL_ID,
      cwd: input.cwd,
      cols,
      rows,
      ...(input.env ? { env: input.env } : {}),
    })
    yield* modifyManagerState(deps, state => {
      const sessions = new Map(state.sessions)
      sessions.set(sessionKey, created)
      return [undefined, { ...state, sessions }] as const
    })
    yield* evictInactiveSessionsIfNeeded(deps)
    return created
  })
}

function buildRestart(deps: TerminalManagerDeps): TerminalManagerShape['restart'] {
  return input =>
    withThreadLock(
      deps,
      input.threadId,
      Effect.gen(function* () {
        const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID
        yield* assertValidCwd(deps, input.cwd)

        const sessionKey = toSessionKey(input.threadId, terminalId)
        const existingSession = yield* getSession(deps, input.threadId, terminalId)
        const session = yield* createOrReuseRestartSession(deps, input, existingSession, sessionKey)

        const cols = input.cols ?? session.cols
        const rows = input.rows ?? session.rows

        session.history = ''
        session.pendingHistoryControlSequence = ''
        session.pendingProcessEvents = []
        session.pendingProcessEventIndex = 0
        session.processEventDrainRunning = false
        yield* persistHistory(deps, input.threadId, terminalId, session.history)
        yield* startSession(
          deps,
          session,
          {
            threadId: input.threadId,
            terminalId,
            cwd: input.cwd,
            cols,
            rows,
            ...(input.env ? { env: input.env } : {}),
          },
          'restarted'
        )
        return snapshot(session)
      })
    )
}

function buildClose(deps: TerminalManagerDeps): TerminalManagerShape['close'] {
  return input =>
    withThreadLock(
      deps,
      input.threadId,
      Effect.gen(function* () {
        if (input.terminalId) {
          yield* closeSession(deps, input.threadId, input.terminalId, input.deleteHistory === true)
          return
        }

        yield* closeAllSessionsForThread(deps, input.threadId, input.deleteHistory === true)
      })
    )
}

export function buildTerminalManagerInterface(deps: TerminalManagerDeps): TerminalManagerShape {
  return {
    open: buildOpen(deps),
    write: buildWrite(deps),
    resize: buildResize(deps),
    clear: buildClear(deps),
    restart: buildRestart(deps),
    close: buildClose(deps),
    subscribe: listener =>
      Effect.sync(() => {
        deps.terminalEventListeners.add(listener)
        return () => {
          deps.terminalEventListeners.delete(listener)
        }
      }),
  } satisfies TerminalManagerShape
}
