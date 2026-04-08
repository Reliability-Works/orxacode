import { Effect, Fiber, Option, SynchronizedRef } from 'effect'

import type { PtyProcess } from '../Services/PTY'

import type { TerminalManagerDeps } from './Manager.deps'
import { TerminalProcessSignalError, type TerminalManagerState } from './Manager.types'

const modifyState = <A>(
  deps: TerminalManagerDeps,
  f: (state: TerminalManagerState) => readonly [A, TerminalManagerState]
) => SynchronizedRef.modify(deps.managerStateRef, f)

export const clearKillFiber = Effect.fn('terminal.clearKillFiber')(function* (
  deps: TerminalManagerDeps,
  process: PtyProcess | null
) {
  if (!process) return
  const fiber: Option.Option<Fiber.Fiber<void, never>> = yield* modifyState<
    Option.Option<Fiber.Fiber<void, never>>
  >(deps, state => {
    const existing: Option.Option<Fiber.Fiber<void, never>> = Option.fromNullishOr(
      state.killFibers.get(process)
    )
    if (Option.isNone(existing)) {
      return [Option.none<Fiber.Fiber<void, never>>(), state] as const
    }
    const killFibers = new Map(state.killFibers)
    killFibers.delete(process)
    return [existing, { ...state, killFibers }] as const
  })
  if (Option.isSome(fiber)) {
    yield* Fiber.interrupt(fiber.value).pipe(Effect.ignore)
  }
})

export const registerKillFiber = Effect.fn('terminal.registerKillFiber')(function* (
  deps: TerminalManagerDeps,
  process: PtyProcess,
  fiber: Fiber.Fiber<void, never>
) {
  yield* modifyState(deps, state => {
    const killFibers = new Map(state.killFibers)
    killFibers.set(process, fiber)
    return [undefined, { ...state, killFibers }] as const
  })
})

export const runKillEscalation = Effect.fn('terminal.runKillEscalation')(function* (
  deps: TerminalManagerDeps,
  process: PtyProcess,
  threadId: string,
  terminalId: string
) {
  const terminated = yield* Effect.try({
    try: () => process.kill('SIGTERM'),
    catch: cause =>
      new TerminalProcessSignalError({
        message: 'Failed to send SIGTERM to terminal process.',
        cause,
        signal: 'SIGTERM',
      }),
  }).pipe(
    Effect.as(true),
    Effect.catch(error =>
      Effect.logWarning('failed to kill terminal process', {
        threadId,
        terminalId,
        signal: 'SIGTERM',
        error: error.message,
      }).pipe(Effect.as(false))
    )
  )
  if (!terminated) {
    return
  }

  yield* Effect.sleep(deps.processKillGraceMs)

  yield* Effect.try({
    try: () => process.kill('SIGKILL'),
    catch: cause =>
      new TerminalProcessSignalError({
        message: 'Failed to send SIGKILL to terminal process.',
        cause,
        signal: 'SIGKILL',
      }),
  }).pipe(
    Effect.catch(error =>
      Effect.logWarning('failed to force-kill terminal process', {
        threadId,
        terminalId,
        signal: 'SIGKILL',
        error: error.message,
      })
    )
  )
})

export const startKillEscalation = Effect.fn('terminal.startKillEscalation')(function* (
  deps: TerminalManagerDeps,
  process: PtyProcess,
  threadId: string,
  terminalId: string
) {
  const fiber = yield* runKillEscalation(deps, process, threadId, terminalId).pipe(
    Effect.ensuring(
      modifyState(deps, state => {
        if (!state.killFibers.has(process)) {
          return [undefined, state] as const
        }
        const killFibers = new Map(state.killFibers)
        killFibers.delete(process)
        return [undefined, { ...state, killFibers }] as const
      })
    ),
    Effect.forkIn(deps.workerScope)
  )

  yield* registerKillFiber(deps, process, fiber)
})
