import type { AuthSessionRole } from '@orxa-code/contracts'
import { Effect, Ref } from 'effect'
import * as Socket from 'effect/unstable/socket/Socket'

import type { LiveSessionSocketRegistration } from './service.types'

type LiveSocketHandle = {
  readonly connectionId: string
  readonly sessionId: string
  readonly role: AuthSessionRole
  readonly close: LiveSessionSocketRegistration['close']
}

export type LiveSocketState = {
  readonly nextConnectionId: number
  readonly handlesByConnectionId: Map<string, LiveSocketHandle>
}

export const DEFAULT_SUPERSEDED_CLOSE_EVENT = new Socket.CloseEvent(
  4001,
  'Superseded by new mobile session'
)

export function createRegisterLiveSocket(stateRef: Ref.Ref<LiveSocketState>) {
  return (registration: LiveSessionSocketRegistration) =>
    Ref.modify(stateRef, state => {
      const connectionId = `live-session-${state.nextConnectionId}`
      const nextHandles = new Map(state.handlesByConnectionId)
      nextHandles.set(connectionId, {
        connectionId,
        sessionId: registration.sessionId,
        role: registration.role,
        close: registration.close,
      })
      return [
        connectionId,
        {
          nextConnectionId: state.nextConnectionId + 1,
          handlesByConnectionId: nextHandles,
        },
      ] as const
    })
}

export function createUnregisterLiveSocket(stateRef: Ref.Ref<LiveSocketState>) {
  return (connectionId: string) =>
    Ref.update(stateRef, state => {
      if (!state.handlesByConnectionId.has(connectionId)) {
        return state
      }
      const nextHandles = new Map(state.handlesByConnectionId)
      nextHandles.delete(connectionId)
      return {
        ...state,
        handlesByConnectionId: nextHandles,
      }
    })
}

function removeLiveSocketHandles(
  state: LiveSocketState,
  predicate: (handle: LiveSocketHandle) => boolean
): readonly [ReadonlyArray<LiveSocketHandle>, LiveSocketState] {
  const nextHandles = new Map<string, LiveSocketHandle>()
  const removedHandles: Array<LiveSocketHandle> = []

  for (const [connectionId, handle] of state.handlesByConnectionId.entries()) {
    if (predicate(handle)) {
      removedHandles.push(handle)
      continue
    }
    nextHandles.set(connectionId, handle)
  }

  return [
    removedHandles,
    {
      ...state,
      handlesByConnectionId: nextHandles,
    },
  ] as const
}

function closeLiveSocketHandles(
  handles: ReadonlyArray<LiveSocketHandle>,
  closeEvent: Socket.CloseEvent
) {
  return Effect.forEach(handles, handle => handle.close(closeEvent).pipe(Effect.as(1)), {
    concurrency: 'unbounded',
  }).pipe(Effect.map(results => results.reduce<number>((total, next) => total + next, 0)))
}

export function createCloseLiveSession(stateRef: Ref.Ref<LiveSocketState>) {
  return (sessionId: string, closeEvent: Socket.CloseEvent = DEFAULT_SUPERSEDED_CLOSE_EVENT) =>
    Ref.modify(stateRef, state =>
      removeLiveSocketHandles(state, handle => handle.sessionId === sessionId)
    ).pipe(Effect.flatMap(handles => closeLiveSocketHandles(handles, closeEvent)))
}

export function createCloseOtherLiveSessionsForRole(stateRef: Ref.Ref<LiveSocketState>) {
  return (
    role: AuthSessionRole,
    currentSessionId: string,
    closeEvent: Socket.CloseEvent = DEFAULT_SUPERSEDED_CLOSE_EVENT
  ) =>
    Ref.modify(stateRef, state =>
      removeLiveSocketHandles(
        state,
        handle => handle.role === role && handle.sessionId !== currentSessionId
      )
    ).pipe(Effect.flatMap(handles => closeLiveSocketHandles(handles, closeEvent)))
}
