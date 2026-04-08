import type { Effect, Fiber, FileSystem, Scope, Semaphore, SynchronizedRef } from 'effect'

import type { TerminalEvent } from '@orxa-code/contracts'
import type { KeyedCoalescingWorker } from '@orxa-code/shared/KeyedCoalescingWorker'

import type { PtyAdapterShape, PtyProcess } from '../Services/PTY'

import type {
  PersistHistoryRequest,
  TerminalManagerOptions,
  TerminalManagerState,
  TerminalSessionState,
  TerminalSubprocessChecker,
} from './Manager.types'

type PersistWorker = KeyedCoalescingWorker<string, PersistHistoryRequest>

export interface TerminalManagerDeps {
  readonly fileSystem: FileSystem.FileSystem
  readonly runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E>
  readonly options: TerminalManagerOptions
  readonly logsDir: string
  readonly historyLineLimit: number
  readonly shellResolver: () => string
  readonly subprocessChecker: TerminalSubprocessChecker
  readonly subprocessPollIntervalMs: number
  readonly processKillGraceMs: number
  readonly maxRetainedInactiveSessions: number
  readonly managerStateRef: SynchronizedRef.SynchronizedRef<TerminalManagerState>
  readonly threadLocksRef: SynchronizedRef.SynchronizedRef<Map<string, Semaphore.Semaphore>>
  readonly terminalEventListeners: Set<(event: TerminalEvent) => Effect.Effect<void>>
  readonly workerScope: Scope.Closeable
  readonly persistWorker: PersistWorker
  readonly ptyAdapter: PtyAdapterShape
}

export type TerminalManagerProcess = PtyProcess
export type TerminalManagerSession = TerminalSessionState
