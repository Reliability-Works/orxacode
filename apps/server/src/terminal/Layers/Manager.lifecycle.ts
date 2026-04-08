import { Effect, Equal, Option } from 'effect'

import { PtySpawnError, type PtyProcess } from '../Services/PTY'

import { bindSessionProcessHandlers, publishEvent } from './Manager.drain'
import type { TerminalManagerDeps } from './Manager.deps'
import { clearKillFiber, startKillEscalation } from './Manager.killEscalation'
import { flushPersist, persistHistory, readHistory } from './Manager.persist'
import {
  cleanupProcessHandles,
  createTerminalSpawnEnv,
  normalizedRuntimeEnv,
  snapshot,
  toSessionKey,
} from './Manager.pure'
import {
  clearSessionProcessQueue,
  createTerminalSessionState,
  evictInactiveSessionsIfNeeded,
  getSession,
  modifyManagerState,
  resetSessionHistory,
  sessionsForThread,
} from './Manager.sessionState'
import {
  formatShellCandidate,
  isRetryableShellSpawnError,
  resolveShellCandidates,
} from './Manager.shellResolver'
import { deleteAllHistoryForThread, deleteHistory } from './Manager.persist'
import type { ShellCandidate, TerminalSessionState, TerminalStartInput } from './Manager.types'

export const stopProcess = Effect.fn('terminal.stopProcess')(function* (
  deps: TerminalManagerDeps,
  session: TerminalSessionState
) {
  const process = session.process
  if (!process) return

  yield* modifyManagerState(deps, state => {
    cleanupProcessHandles(session)
    session.process = null
    session.pid = null
    session.hasRunningSubprocess = false
    session.status = 'exited'
    clearSessionProcessQueue(session, { resetPendingHistoryControlSequence: true })
    session.updatedAt = new Date().toISOString()
    return [undefined, state] as const
  })

  yield* clearKillFiber(deps, process)
  yield* startKillEscalation(deps, process, session.threadId, session.terminalId)
  yield* evictInactiveSessionsIfNeeded(deps)
})

export const markSessionAsStarting = Effect.fn('terminal.markSessionAsStarting')(function* (
  deps: TerminalManagerDeps,
  session: TerminalSessionState,
  input: TerminalStartInput
) {
  yield* modifyManagerState(deps, state => {
    session.status = 'starting'
    session.cwd = input.cwd
    session.cols = input.cols
    session.rows = input.rows
    session.exitCode = null
    session.exitSignal = null
    session.hasRunningSubprocess = false
    clearSessionProcessQueue(session, { resetPendingHistoryControlSequence: true })
    session.updatedAt = new Date().toISOString()
    return [undefined, state] as const
  })
})

export const setSessionRunning = Effect.fn('terminal.setSessionRunning')(function* (
  deps: TerminalManagerDeps,
  session: TerminalSessionState,
  process: PtyProcess
) {
  const handlers = bindSessionProcessHandlers(deps, session, process)
  yield* modifyManagerState(deps, state => {
    session.process = process
    session.pid = handlers.processPid
    session.status = 'running'
    session.updatedAt = new Date().toISOString()
    session.unsubscribeData = handlers.unsubscribeData
    session.unsubscribeExit = handlers.unsubscribeExit
    return [undefined, state] as const
  })
})

export const handleStartFailure = Effect.fn('terminal.handleStartFailure')(function* (
  deps: TerminalManagerDeps,
  session: TerminalSessionState,
  error: PtySpawnError,
  process: PtyProcess | null
) {
  if (process) {
    yield* startKillEscalation(deps, process, session.threadId, session.terminalId)
  }

  yield* modifyManagerState(deps, state => {
    session.status = 'error'
    session.pid = null
    session.process = null
    session.unsubscribeData = null
    session.unsubscribeExit = null
    session.hasRunningSubprocess = false
    clearSessionProcessQueue(session, { resetPendingHistoryControlSequence: true })
    session.updatedAt = new Date().toISOString()
    return [undefined, state] as const
  })

  yield* evictInactiveSessionsIfNeeded(deps)

  const message = error.message
  yield* publishEvent(deps, {
    type: 'error',
    threadId: session.threadId,
    terminalId: session.terminalId,
    createdAt: new Date().toISOString(),
    message,
  })
  return message
})

export const trySpawn = Effect.fn('terminal.trySpawn')(function* (
  deps: TerminalManagerDeps,
  shellCandidates: ReadonlyArray<ShellCandidate>,
  spawnEnv: NodeJS.ProcessEnv,
  session: TerminalSessionState,
  index = 0,
  lastError: PtySpawnError | null = null
): Effect.fn.Return<{ process: PtyProcess; shellLabel: string }, PtySpawnError> {
  if (index >= shellCandidates.length) {
    const detail = lastError?.message ?? 'Failed to spawn PTY process'
    const tried =
      shellCandidates.length > 0
        ? ` Tried shells: ${shellCandidates.map(candidate => formatShellCandidate(candidate)).join(', ')}.`
        : ''
    return yield* new PtySpawnError({
      adapter: 'terminal-manager',
      message: `${detail}.${tried}`.trim(),
      ...(lastError ? { cause: lastError } : {}),
    })
  }

  const candidate = shellCandidates[index]
  if (!candidate) {
    return yield* lastError ??
      new PtySpawnError({
        adapter: 'terminal-manager',
        message: 'No shell candidate available for PTY spawn.',
      })
  }

  const attempt = yield* Effect.result(
    deps.ptyAdapter.spawn({
      shell: candidate.shell,
      ...(candidate.args ? { args: candidate.args } : {}),
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      env: spawnEnv,
    })
  )

  if (attempt._tag === 'Success') {
    return {
      process: attempt.success,
      shellLabel: formatShellCandidate(candidate),
    }
  }

  const spawnError = attempt.failure
  if (!isRetryableShellSpawnError(spawnError)) {
    return yield* spawnError
  }

  return yield* trySpawn(deps, shellCandidates, spawnEnv, session, index + 1, spawnError)
})

export const startSession = Effect.fn('terminal.startSession')(function* (
  deps: TerminalManagerDeps,
  session: TerminalSessionState,
  input: TerminalStartInput,
  eventType: 'started' | 'restarted'
) {
  yield* stopProcess(deps, session)
  yield* markSessionAsStarting(deps, session, input)

  let ptyProcess: PtyProcess | null = null
  let startedShell: string | null = null

  const startResult = yield* Effect.result(
    Effect.gen(function* () {
      const shellCandidates = resolveShellCandidates(deps.shellResolver)
      const terminalEnv = createTerminalSpawnEnv(process.env, session.runtimeEnv)
      const spawnResult = yield* trySpawn(deps, shellCandidates, terminalEnv, session)
      ptyProcess = spawnResult.process
      startedShell = spawnResult.shellLabel
      yield* setSessionRunning(deps, session, ptyProcess)

      yield* publishEvent(deps, {
        type: eventType,
        threadId: session.threadId,
        terminalId: session.terminalId,
        createdAt: new Date().toISOString(),
        snapshot: snapshot(session),
      })
    })
  )

  if (startResult._tag === 'Success') {
    return
  }

  const message = yield* handleStartFailure(deps, session, startResult.failure, ptyProcess)
  yield* Effect.logError('failed to start terminal', {
    threadId: session.threadId,
    terminalId: session.terminalId,
    error: message,
    ...(startedShell ? { shell: startedShell } : {}),
  })
})

export const closeSession = Effect.fn('terminal.closeSession')(function* (
  deps: TerminalManagerDeps,
  threadId: string,
  terminalId: string,
  deleteHistoryOnClose: boolean
) {
  const key = toSessionKey(threadId, terminalId)
  const session = yield* getSession(deps, threadId, terminalId)

  if (Option.isSome(session)) {
    yield* stopProcess(deps, session.value)
    yield* persistHistory(deps, threadId, terminalId, session.value.history)
  }

  yield* flushPersist(deps, threadId, terminalId)

  yield* modifyManagerState(deps, state => {
    if (!state.sessions.has(key)) {
      return [undefined, state] as const
    }
    const sessions = new Map(state.sessions)
    sessions.delete(key)
    return [undefined, { ...state, sessions }] as const
  })

  if (deleteHistoryOnClose) {
    yield* deleteHistory(deps, threadId, terminalId)
  }
})

export const openNewSession = Effect.fn('terminal.openNewSession')(function* (
  deps: TerminalManagerDeps,
  input: TerminalStartInput,
  sessionKey: string
) {
  yield* flushPersist(deps, input.threadId, input.terminalId)
  const history = yield* readHistory(deps, input.threadId, input.terminalId)
  const session = createTerminalSessionState(input)
  session.history = history

  yield* modifyManagerState(deps, state => {
    const sessions = new Map(state.sessions)
    sessions.set(sessionKey, session)
    return [undefined, { ...state, sessions }] as const
  })
  yield* evictInactiveSessionsIfNeeded(deps)
  yield* startSession(deps, session, input, 'started')
  return snapshot(session)
})

export const openExistingSession = Effect.fn('terminal.openExistingSession')(function* (
  deps: TerminalManagerDeps,
  session: TerminalSessionState,
  input: TerminalStartInput
) {
  const nextRuntimeEnv = normalizedRuntimeEnv(input.env)
  const runtimeEnvChanged = !Equal.equals(session.runtimeEnv, nextRuntimeEnv)
  if (session.cwd !== input.cwd || runtimeEnvChanged) {
    yield* stopProcess(deps, session)
    session.cwd = input.cwd
    session.runtimeEnv = nextRuntimeEnv
    yield* resetSessionHistory(deps, session)
  } else if (session.status === 'exited' || session.status === 'error') {
    session.runtimeEnv = nextRuntimeEnv
    yield* resetSessionHistory(deps, session)
  }

  if (!session.process) {
    yield* startSession(deps, session, input, 'started')
    return snapshot(session)
  }

  if (session.cols !== input.cols || session.rows !== input.rows) {
    session.cols = input.cols
    session.rows = input.rows
    session.updatedAt = new Date().toISOString()
    session.process.resize(input.cols, input.rows)
  }
  return snapshot(session)
})

export const closeAllSessionsForThread = Effect.fn('terminal.closeAllSessionsForThread')(function* (
  deps: TerminalManagerDeps,
  threadId: string,
  deleteHistoryOnClose: boolean
) {
  const threadSessions = yield* sessionsForThread(deps, threadId)
  yield* Effect.forEach(
    threadSessions,
    session => closeSession(deps, threadId, session.terminalId, false),
    { discard: true }
  )

  if (deleteHistoryOnClose) {
    yield* deleteAllHistoryForThread(deps, threadId)
  }
})
