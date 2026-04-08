import { Effect } from 'effect'

import type { TerminalEvent } from '@orxa-code/contracts'

import type { PtyExitEvent, PtyProcess } from '../Services/PTY'

import type { TerminalManagerDeps } from './Manager.deps'
import { capHistory, cleanupProcessHandles, enqueueProcessEvent } from './Manager.pure'
import { sanitizeTerminalHistoryChunk } from './Manager.sanitize'
import { clearKillFiber } from './Manager.killEscalation'
import { queuePersist } from './Manager.persist'
import { clearSessionProcessQueue, evictInactiveSessionsIfNeeded } from './Manager.sessionState'
import type { DrainProcessEventAction, TerminalSessionState } from './Manager.types'

export const publishEvent = (deps: TerminalManagerDeps, event: TerminalEvent) =>
  Effect.gen(function* () {
    for (const listener of deps.terminalEventListeners) {
      yield* listener(event).pipe(Effect.ignoreCause({ log: true }))
    }
  })

function applyOutputDrainAction(
  deps: TerminalManagerDeps,
  session: TerminalSessionState,
  data: string
): Extract<DrainProcessEventAction, { type: 'output' }> {
  const sanitized = sanitizeTerminalHistoryChunk(session.pendingHistoryControlSequence, data)
  session.pendingHistoryControlSequence = sanitized.pendingControlSequence
  if (sanitized.visibleText.length > 0) {
    session.history = capHistory(
      `${session.history}${sanitized.visibleText}`,
      deps.historyLineLimit
    )
  }
  session.updatedAt = new Date().toISOString()

  return {
    type: 'output',
    threadId: session.threadId,
    terminalId: session.terminalId,
    history: sanitized.visibleText.length > 0 ? session.history : null,
    data,
  }
}

function applyExitDrainAction(
  session: TerminalSessionState,
  event: PtyExitEvent
): Extract<DrainProcessEventAction, { type: 'exit' }> {
  const process = session.process
  cleanupProcessHandles(session)
  session.process = null
  session.pid = null
  session.hasRunningSubprocess = false
  session.status = 'exited'
  clearSessionProcessQueue(session, { resetPendingHistoryControlSequence: true })
  session.exitCode = Number.isInteger(event.exitCode) ? event.exitCode : null
  session.exitSignal = Number.isInteger(event.signal) ? event.signal : null
  session.updatedAt = new Date().toISOString()

  return {
    type: 'exit',
    process,
    threadId: session.threadId,
    terminalId: session.terminalId,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
  }
}

export const nextDrainProcessEventAction = (
  deps: TerminalManagerDeps,
  session: TerminalSessionState,
  expectedPid: number
): DrainProcessEventAction => {
  if (session.pid !== expectedPid || !session.process || session.status !== 'running') {
    clearSessionProcessQueue(session)
    return { type: 'idle' }
  }

  const nextEvent = session.pendingProcessEvents[session.pendingProcessEventIndex]
  if (!nextEvent) {
    clearSessionProcessQueue(session)
    return { type: 'idle' }
  }

  session.pendingProcessEventIndex += 1
  if (session.pendingProcessEventIndex >= session.pendingProcessEvents.length) {
    session.pendingProcessEvents = []
    session.pendingProcessEventIndex = 0
  }

  if (nextEvent.type === 'output') {
    return applyOutputDrainAction(deps, session, nextEvent.data)
  }

  return applyExitDrainAction(session, nextEvent.event)
}

export const emitDrainOutputEvent = Effect.fn('terminal.emitDrainOutputEvent')(function* (
  deps: TerminalManagerDeps,
  action: Extract<DrainProcessEventAction, { type: 'output' }>
) {
  if (action.history !== null) {
    yield* queuePersist(deps, action.threadId, action.terminalId, action.history)
  }

  yield* publishEvent(deps, {
    type: 'output',
    threadId: action.threadId,
    terminalId: action.terminalId,
    createdAt: new Date().toISOString(),
    data: action.data,
  })
})

export const emitDrainExitEvent = Effect.fn('terminal.emitDrainExitEvent')(function* (
  deps: TerminalManagerDeps,
  action: Extract<DrainProcessEventAction, { type: 'exit' }>
) {
  yield* clearKillFiber(deps, action.process)
  yield* publishEvent(deps, {
    type: 'exited',
    threadId: action.threadId,
    terminalId: action.terminalId,
    createdAt: new Date().toISOString(),
    exitCode: action.exitCode,
    exitSignal: action.exitSignal,
  })
  yield* evictInactiveSessionsIfNeeded(deps)
})

export const drainProcessEvents = Effect.fn('terminal.drainProcessEvents')(function* (
  deps: TerminalManagerDeps,
  session: TerminalSessionState,
  expectedPid: number
) {
  while (true) {
    const action: DrainProcessEventAction = yield* Effect.sync(() =>
      nextDrainProcessEventAction(deps, session, expectedPid)
    )

    if (action.type === 'idle') {
      return
    }

    if (action.type === 'output') {
      yield* emitDrainOutputEvent(deps, action)
      continue
    }

    yield* emitDrainExitEvent(deps, action)
    return
  }
})

export const bindSessionProcessHandlers = (
  deps: TerminalManagerDeps,
  session: TerminalSessionState,
  process: PtyProcess
) => {
  const processPid = process.pid
  const unsubscribeData = process.onData(data => {
    if (!enqueueProcessEvent(session, processPid, { type: 'output', data })) {
      return
    }
    deps.runFork(drainProcessEvents(deps, session, processPid))
  })
  const unsubscribeExit = process.onExit(event => {
    if (!enqueueProcessEvent(session, processPid, { type: 'exit', event })) {
      return
    }
    deps.runFork(drainProcessEvents(deps, session, processPid))
  })
  return { processPid, unsubscribeData, unsubscribeExit }
}
