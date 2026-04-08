import { Effect, Exit, FileSystem, Layer, Scope, Semaphore, SynchronizedRef } from 'effect'

import type { TerminalEvent } from '@orxa-code/contracts'
import { makeKeyedCoalescingWorker } from '@orxa-code/shared/KeyedCoalescingWorker'

import { ServerConfig } from '../../config'
import { TerminalManager } from '../Services/Manager'
import { PtyAdapter } from '../Services/PTY'

import type { TerminalManagerDeps } from './Manager.deps'
import { runKillEscalation, clearKillFiber } from './Manager.killEscalation'
import {
  DEFAULT_PERSIST_DEBOUNCE_MS,
  DEFAULT_HISTORY_LINE_LIMIT,
  DEFAULT_MAX_RETAINED_INACTIVE_SESSIONS,
  DEFAULT_PROCESS_KILL_GRACE_MS,
  DEFAULT_SUBPROCESS_POLL_INTERVAL_MS,
  type PersistHistoryRequest,
  type TerminalManagerOptions,
  type TerminalManagerState,
  type TerminalSessionState,
} from './Manager.types'
import { defaultShellResolver } from './Manager.shellResolver'
import { defaultSubprocessChecker } from './Manager.subprocessCheck'
import { cleanupProcessHandles } from './Manager.pure'
import { buildHistoryPath } from './Manager.persist'
import { hasRunningSessions, pollSubprocessActivity } from './Manager.subprocessPolling'
import { modifyManagerState } from './Manager.sessionState'
import { buildTerminalManagerInterface } from './Manager.publicOps'

export type { TerminalManagerOptions } from './Manager.types'

const makeTerminalManager = Effect.fn('makeTerminalManager')(function* () {
  const { terminalLogsDir } = yield* ServerConfig
  const ptyAdapter = yield* PtyAdapter
  return yield* makeTerminalManagerWithOptions({
    logsDir: terminalLogsDir,
    ptyAdapter,
  })
})

const buildPersistWorker = (fileSystem: FileSystem.FileSystem, options: { logsDir: string }) =>
  makeKeyedCoalescingWorker<string, PersistHistoryRequest, never, never>({
    merge: (current, next) => ({
      history: next.history,
      immediate: current.immediate || next.immediate,
    }),
    process: Effect.fn('terminal.persistHistoryWorker')(function* (sessionKey, request) {
      if (!request.immediate) {
        yield* Effect.sleep(DEFAULT_PERSIST_DEBOUNCE_MS)
      }

      const [threadId, terminalId] = sessionKey.split('\u0000')
      if (!threadId || !terminalId) {
        return
      }

      yield* fileSystem
        .writeFileString(buildHistoryPath(options.logsDir, threadId, terminalId), request.history)
        .pipe(
          Effect.catch(error =>
            Effect.logWarning('failed to persist terminal history', {
              threadId,
              terminalId,
              error: error instanceof Error ? error.message : String(error),
            })
          )
        )
    }),
  })

const cleanupSessionFinalizer = (deps: TerminalManagerDeps, session: TerminalSessionState) =>
  Effect.gen(function* () {
    cleanupProcessHandles(session)
    if (!session.process) return
    yield* clearKillFiber(deps, session.process)
    yield* runKillEscalation(deps, session.process, session.threadId, session.terminalId)
  })

const installManagerFinalizer = (deps: TerminalManagerDeps) =>
  Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const sessions = yield* modifyManagerState(
        deps,
        state =>
          [
            [...state.sessions.values()],
            {
              ...state,
              sessions: new Map(),
            },
          ] as const
      )

      yield* Effect.forEach(sessions, session => cleanupSessionFinalizer(deps, session), {
        concurrency: 'unbounded',
        discard: true,
      })
    }).pipe(Effect.ignoreCause({ log: true }))
  )

const installSubprocessPoller = (deps: TerminalManagerDeps) =>
  Effect.forever(
    hasRunningSessions(deps).pipe(
      Effect.flatMap(active =>
        active
          ? pollSubprocessActivity(deps).pipe(
              Effect.flatMap(() => Effect.sleep(deps.subprocessPollIntervalMs))
            )
          : Effect.sleep(deps.subprocessPollIntervalMs)
      )
    )
  ).pipe(Effect.forkIn(deps.workerScope))

export const makeTerminalManagerWithOptions = Effect.fn('makeTerminalManagerWithOptions')(
  function* (options: TerminalManagerOptions) {
    const fileSystem = yield* FileSystem.FileSystem
    const services = yield* Effect.services()
    const runFork = Effect.runForkWith(services)

    const logsDir = options.logsDir

    yield* fileSystem.makeDirectory(logsDir, { recursive: true }).pipe(Effect.orDie)

    const managerStateRef = yield* SynchronizedRef.make<TerminalManagerState>({
      sessions: new Map(),
      killFibers: new Map(),
    })
    const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>())
    const terminalEventListeners = new Set<(event: TerminalEvent) => Effect.Effect<void>>()
    const workerScope = yield* Scope.make('sequential')
    yield* Effect.addFinalizer(() => Scope.close(workerScope, Exit.void))

    const persistWorker = yield* buildPersistWorker(fileSystem, { logsDir })

    const deps: TerminalManagerDeps = {
      fileSystem,
      runFork,
      options,
      logsDir,
      historyLineLimit: options.historyLineLimit ?? DEFAULT_HISTORY_LINE_LIMIT,
      shellResolver: options.shellResolver ?? defaultShellResolver,
      subprocessChecker: options.subprocessChecker ?? defaultSubprocessChecker,
      subprocessPollIntervalMs:
        options.subprocessPollIntervalMs ?? DEFAULT_SUBPROCESS_POLL_INTERVAL_MS,
      processKillGraceMs: options.processKillGraceMs ?? DEFAULT_PROCESS_KILL_GRACE_MS,
      maxRetainedInactiveSessions:
        options.maxRetainedInactiveSessions ?? DEFAULT_MAX_RETAINED_INACTIVE_SESSIONS,
      managerStateRef,
      threadLocksRef,
      terminalEventListeners,
      workerScope,
      persistWorker,
      ptyAdapter: options.ptyAdapter,
    }

    yield* installSubprocessPoller(deps)
    yield* installManagerFinalizer(deps)

    return buildTerminalManagerInterface(deps)
  }
)

export const TerminalManagerLive = Layer.effect(TerminalManager, makeTerminalManager())
