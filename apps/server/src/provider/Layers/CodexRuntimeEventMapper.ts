import { type ProviderEvent, type ProviderRuntimeEvent, ThreadId } from '@orxa-code/contracts'

import {
  asObject,
  asString,
  decodeProviderApprovalDecision,
  runtimeEventBase,
  toRequestTypeFromKind,
  toRequestTypeFromMethod,
  toUserInputQuestions,
} from './CodexRuntimeEventUtils.ts'
import { mapItemEvent } from './CodexRuntimeEventMapper.items.ts'
import { mapCodexEvent, mapMiscEvent } from './CodexRuntimeEventMapper.misc.ts'
import { mapThreadEvent, mapTurnEvent } from './CodexRuntimeEventMapper.threadTurn.ts'

function mapErrorEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): ReadonlyArray<ProviderRuntimeEvent> | undefined {
  if (event.kind !== 'error' || !event.message) {
    return undefined
  }

  return [
    {
      ...runtimeEventBase(event, canonicalThreadId),
      type: 'runtime.error',
      payload: {
        message: event.message,
        class: 'provider_error',
        ...(event.payload !== undefined ? { detail: event.payload } : {}),
      },
    },
  ]
}

function mapRequestEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): ReadonlyArray<ProviderRuntimeEvent> | undefined {
  const payload = asObject(event.payload)
  if (event.kind === 'request' && event.method === 'item/tool/requestUserInput') {
    const questions = toUserInputQuestions(payload)
    return questions
      ? [
          {
            ...runtimeEventBase(event, canonicalThreadId),
            type: 'user-input.requested',
            payload: { questions },
          },
        ]
      : []
  }

  if (event.kind !== 'request') {
    return undefined
  }

  const detail =
    asString(payload?.command) ?? asString(payload?.reason) ?? asString(payload?.prompt)
  return [
    {
      ...runtimeEventBase(event, canonicalThreadId),
      type: 'request.opened',
      payload: {
        requestType: toRequestTypeFromMethod(event.method),
        ...(detail ? { detail } : {}),
        ...(event.payload !== undefined ? { args: event.payload } : {}),
      },
    },
  ]
}

function mapApprovalDecisionEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): ReadonlyArray<ProviderRuntimeEvent> | undefined {
  if (event.method !== 'item/requestApproval/decision' || !event.requestId) {
    return undefined
  }
  const payload = asObject(event.payload)
  return [
    {
      ...runtimeEventBase(event, canonicalThreadId),
      type: 'request.resolved',
      payload: {
        requestType:
          event.requestKind !== undefined
            ? toRequestTypeFromKind(event.requestKind)
            : toRequestTypeFromMethod(event.method),
        ...(decodeProviderApprovalDecision(payload?.decision)
          ? { decision: decodeProviderApprovalDecision(payload?.decision) }
          : {}),
        ...(event.payload !== undefined ? { resolution: event.payload } : {}),
      },
    },
  ]
}

const SESSION_STATES: Record<string, 'starting' | 'ready'> = {
  'session/connecting': 'starting',
  'session/ready': 'ready',
}

function mapSessionLifecycleEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): ReadonlyArray<ProviderRuntimeEvent> | undefined {
  const state = SESSION_STATES[event.method]
  if (state) {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: 'session.state.changed',
        payload: {
          state,
          ...(event.message ? { reason: event.message } : {}),
        },
      },
    ]
  }

  if (event.method === 'session/started') {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: 'session.started',
        payload: {
          ...(event.message ? { message: event.message } : {}),
          ...(event.payload !== undefined ? { resume: event.payload } : {}),
        },
      },
    ]
  }

  if (event.method === 'session/exited' || event.method === 'session/closed') {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: 'session.exited',
        payload: {
          ...(event.message ? { reason: event.message } : {}),
          ...(event.method === 'session/closed' ? { exitKind: 'graceful' } : {}),
        },
      },
    ]
  }

  return undefined
}

function mapSessionEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): ReadonlyArray<ProviderRuntimeEvent> | undefined {
  return (
    mapApprovalDecisionEvent(event, canonicalThreadId) ??
    mapSessionLifecycleEvent(event, canonicalThreadId)
  )
}

const MAPPERS = [
  mapErrorEvent,
  mapRequestEvent,
  mapSessionEvent,
  mapThreadEvent,
  mapTurnEvent,
  mapItemEvent,
  mapCodexEvent,
  mapMiscEvent,
] as const

export function mapToRuntimeEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): ReadonlyArray<ProviderRuntimeEvent> {
  for (const mapper of MAPPERS) {
    const mapped = mapper(event, canonicalThreadId)
    if (mapped !== undefined) {
      return mapped
    }
  }
  return []
}
