import { Effect, Option } from 'effect'

import { publishEvent } from './Manager.drain'
import type { TerminalManagerDeps } from './Manager.deps'
import { toSessionKey } from './Manager.pure'
import { modifyManagerState, readManagerState } from './Manager.sessionState'
import type { TerminalSessionState } from './Manager.types'

const checkSubprocessActivity = Effect.fn('terminal.checkSubprocessActivity')(function* (
  deps: TerminalManagerDeps,
  session: TerminalSessionState & { pid: number }
) {
  const terminalPid = session.pid
  const hasRunningSubprocess = yield* deps.subprocessChecker(terminalPid).pipe(
    Effect.map(Option.some),
    Effect.catch(error =>
      Effect.logWarning('failed to check terminal subprocess activity', {
        threadId: session.threadId,
        terminalId: session.terminalId,
        terminalPid,
        error: error instanceof Error ? error.message : String(error),
      }).pipe(Effect.as(Option.none<boolean>()))
    )
  )

  if (Option.isNone(hasRunningSubprocess)) {
    return
  }

  const event = yield* modifyManagerState(deps, state => {
    const liveSession: Option.Option<TerminalSessionState> = Option.fromNullishOr(
      state.sessions.get(toSessionKey(session.threadId, session.terminalId))
    )
    if (
      Option.isNone(liveSession) ||
      liveSession.value.status !== 'running' ||
      liveSession.value.pid !== terminalPid ||
      liveSession.value.hasRunningSubprocess === hasRunningSubprocess.value
    ) {
      return [Option.none(), state] as const
    }

    liveSession.value.hasRunningSubprocess = hasRunningSubprocess.value
    liveSession.value.updatedAt = new Date().toISOString()

    return [
      Option.some({
        type: 'activity' as const,
        threadId: liveSession.value.threadId,
        terminalId: liveSession.value.terminalId,
        createdAt: new Date().toISOString(),
        hasRunningSubprocess: hasRunningSubprocess.value,
      }),
      state,
    ] as const
  })

  if (Option.isSome(event)) {
    yield* publishEvent(deps, event.value)
  }
})

export const pollSubprocessActivity = Effect.fn('terminal.pollSubprocessActivity')(function* (
  deps: TerminalManagerDeps
) {
  const state = yield* readManagerState(deps)
  const runningSessions = [...state.sessions.values()].filter(
    (session): session is TerminalSessionState & { pid: number } =>
      session.status === 'running' && Number.isInteger(session.pid)
  )

  if (runningSessions.length === 0) {
    return
  }

  yield* Effect.forEach(runningSessions, session => checkSubprocessActivity(deps, session), {
    concurrency: 'unbounded',
    discard: true,
  })
})

export const hasRunningSessions = (deps: TerminalManagerDeps) =>
  readManagerState(deps).pipe(
    Effect.map(state => [...state.sessions.values()].some(session => session.status === 'running'))
  )
