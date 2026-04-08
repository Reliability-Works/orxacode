import path from 'node:path'

import { DEFAULT_TERMINAL_ID } from '@orxa-code/contracts'
import { Effect } from 'effect'

import { TerminalHistoryError } from '../Services/Manager'

import type { TerminalManagerDeps } from './Manager.deps'
import {
  capHistory,
  legacySafeThreadId,
  toSafeThreadId,
  toSafeTerminalId,
  toSessionKey,
} from './Manager.pure'

export function buildHistoryPath(logsDir: string, threadId: string, terminalId: string): string {
  const threadPart = toSafeThreadId(threadId)
  if (terminalId === DEFAULT_TERMINAL_ID) {
    return path.join(logsDir, `${threadPart}.log`)
  }
  return path.join(logsDir, `${threadPart}_${toSafeTerminalId(terminalId)}.log`)
}

export function buildLegacyHistoryPath(logsDir: string, threadId: string): string {
  return path.join(logsDir, `${legacySafeThreadId(threadId)}.log`)
}

export function historyPath(
  deps: TerminalManagerDeps,
  threadId: string,
  terminalId: string
): string {
  return buildHistoryPath(deps.logsDir, threadId, terminalId)
}

export function legacyHistoryPath(deps: TerminalManagerDeps, threadId: string): string {
  return buildLegacyHistoryPath(deps.logsDir, threadId)
}

export const toTerminalHistoryError =
  (operation: 'read' | 'truncate' | 'migrate', threadId: string, terminalId: string) =>
  (cause: unknown) =>
    new TerminalHistoryError({
      operation,
      threadId,
      terminalId,
      cause,
    })

export const queuePersist = Effect.fn('terminal.queuePersist')(function* (
  deps: TerminalManagerDeps,
  threadId: string,
  terminalId: string,
  history: string
) {
  yield* deps.persistWorker.enqueue(toSessionKey(threadId, terminalId), {
    history,
    immediate: false,
  })
})

export const flushPersist = Effect.fn('terminal.flushPersist')(function* (
  deps: TerminalManagerDeps,
  threadId: string,
  terminalId: string
) {
  yield* deps.persistWorker.drainKey(toSessionKey(threadId, terminalId))
})

export const persistHistory = Effect.fn('terminal.persistHistory')(function* (
  deps: TerminalManagerDeps,
  threadId: string,
  terminalId: string,
  history: string
) {
  yield* deps.persistWorker.enqueue(toSessionKey(threadId, terminalId), {
    history,
    immediate: true,
  })
  yield* flushPersist(deps, threadId, terminalId)
})

export const readHistory = Effect.fn('terminal.readHistory')(function* (
  deps: TerminalManagerDeps,
  threadId: string,
  terminalId: string
) {
  const nextPath = historyPath(deps, threadId, terminalId)
  if (
    yield* deps.fileSystem
      .exists(nextPath)
      .pipe(Effect.mapError(toTerminalHistoryError('read', threadId, terminalId)))
  ) {
    const raw = yield* deps.fileSystem
      .readFileString(nextPath)
      .pipe(Effect.mapError(toTerminalHistoryError('read', threadId, terminalId)))
    const capped = capHistory(raw, deps.historyLineLimit)
    if (capped !== raw) {
      yield* deps.fileSystem
        .writeFileString(nextPath, capped)
        .pipe(Effect.mapError(toTerminalHistoryError('truncate', threadId, terminalId)))
    }
    return capped
  }

  if (terminalId !== DEFAULT_TERMINAL_ID) {
    return ''
  }

  const legacyPath = legacyHistoryPath(deps, threadId)
  if (
    !(yield* deps.fileSystem
      .exists(legacyPath)
      .pipe(Effect.mapError(toTerminalHistoryError('migrate', threadId, terminalId))))
  ) {
    return ''
  }

  const raw = yield* deps.fileSystem
    .readFileString(legacyPath)
    .pipe(Effect.mapError(toTerminalHistoryError('migrate', threadId, terminalId)))
  const capped = capHistory(raw, deps.historyLineLimit)
  yield* deps.fileSystem
    .writeFileString(nextPath, capped)
    .pipe(Effect.mapError(toTerminalHistoryError('migrate', threadId, terminalId)))
  yield* deps.fileSystem.remove(legacyPath, { force: true }).pipe(
    Effect.catch(cleanupError =>
      Effect.logWarning('failed to remove legacy terminal history', {
        threadId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      })
    )
  )
  return capped
})

const removeHistoryFile = (
  deps: TerminalManagerDeps,
  path: string,
  threadId: string,
  terminalId: string
) =>
  deps.fileSystem.remove(path, { force: true }).pipe(
    Effect.catch(error =>
      Effect.logWarning('failed to delete terminal history', {
        threadId,
        terminalId,
        error: error instanceof Error ? error.message : String(error),
      })
    )
  )

export const deleteHistory = Effect.fn('terminal.deleteHistory')(function* (
  deps: TerminalManagerDeps,
  threadId: string,
  terminalId: string
) {
  yield* removeHistoryFile(deps, historyPath(deps, threadId, terminalId), threadId, terminalId)
  if (terminalId === DEFAULT_TERMINAL_ID) {
    yield* removeHistoryFile(deps, legacyHistoryPath(deps, threadId), threadId, terminalId)
  }
})

export const deleteAllHistoryForThread = Effect.fn('terminal.deleteAllHistoryForThread')(function* (
  deps: TerminalManagerDeps,
  threadId: string
) {
  const threadPrefix = `${toSafeThreadId(threadId)}_`
  const entries = yield* deps.fileSystem
    .readDirectory(deps.logsDir, { recursive: false })
    .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)))
  yield* Effect.forEach(
    entries.filter(
      name =>
        name === `${toSafeThreadId(threadId)}.log` ||
        name === `${legacySafeThreadId(threadId)}.log` ||
        name.startsWith(threadPrefix)
    ),
    name =>
      deps.fileSystem.remove(path.join(deps.logsDir, name), { force: true }).pipe(
        Effect.catch(error =>
          Effect.logWarning('failed to delete terminal histories for thread', {
            threadId,
            error: error instanceof Error ? error.message : String(error),
          })
        )
      ),
    { discard: true }
  )
})
