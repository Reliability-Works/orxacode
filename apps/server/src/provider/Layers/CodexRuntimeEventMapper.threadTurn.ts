import { type ProviderEvent, type ProviderRuntimeEvent, ThreadId } from '@orxa-code/contracts'

import {
  asNumber,
  asObject,
  asString,
  normalizeCodexTokenUsage,
  runtimeEventBase,
  toThreadState,
  toTurnStatus,
} from './CodexRuntimeEventUtils.ts'
import { runtimeEvents } from './CodexRuntimeEventMapper.shared.ts'

const THREAD_STATE_METHODS = new Set([
  'thread/status/changed',
  'thread/archived',
  'thread/unarchived',
  'thread/closed',
  'thread/compacted',
])

function mapThreadStateEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  payload: Record<string, unknown> | undefined
) {
  if (!THREAD_STATE_METHODS.has(event.method)) {
    return undefined
  }
  const state =
    event.method === 'thread/archived'
      ? 'archived'
      : event.method === 'thread/closed'
        ? 'closed'
        : event.method === 'thread/compacted'
          ? 'compacted'
          : toThreadState(asObject(payload?.thread)?.state ?? payload?.state)
  return runtimeEvents({
    type: 'thread.state.changed',
    ...runtimeEventBase(event, canonicalThreadId),
    payload: { state, ...(event.payload !== undefined ? { detail: event.payload } : {}) },
  })
}

const THREAD_REALTIME_MAPPERS: Record<
  string,
  (
    event: ProviderEvent,
    canonicalThreadId: ThreadId,
    payload: Record<string, unknown> | undefined
  ) => ReadonlyArray<ProviderRuntimeEvent>
> = {
  'thread/realtime/started': (event, canonicalThreadId, payload) =>
    runtimeEvents({
      type: 'thread.realtime.started',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: { realtimeSessionId: asString(payload?.realtimeSessionId) },
    }),
  'thread/realtime/itemAdded': (event, canonicalThreadId) =>
    runtimeEvents({
      type: 'thread.realtime.item-added',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: { item: event.payload ?? {} },
    }),
  'thread/realtime/outputAudio/delta': (event, canonicalThreadId) =>
    runtimeEvents({
      type: 'thread.realtime.audio.delta',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: { audio: event.payload ?? {} },
    }),
  'thread/realtime/error': (event, canonicalThreadId, payload) =>
    runtimeEvents({
      type: 'thread.realtime.error',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: { message: asString(payload?.message) ?? event.message ?? 'Realtime error' },
    }),
  'thread/realtime/closed': (event, canonicalThreadId) =>
    runtimeEvents({
      type: 'thread.realtime.closed',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: { reason: event.message },
    }),
}

export function mapThreadEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): ReadonlyArray<ProviderRuntimeEvent> | undefined {
  const payload = asObject(event.payload)
  if (event.method === 'thread/started') {
    const providerThreadId = asString(asObject(payload?.thread)?.id) ?? asString(payload?.threadId)
    return providerThreadId
      ? [
          {
            ...runtimeEventBase(event, canonicalThreadId),
            type: 'thread.started',
            payload: { providerThreadId },
          },
        ]
      : []
  }
  if (event.method === 'thread/name/updated') {
    return [
      {
        type: 'thread.metadata.updated',
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          ...(asString(payload?.threadName) ? { name: asString(payload?.threadName) } : {}),
          ...(event.payload !== undefined ? { metadata: asObject(event.payload) } : {}),
        },
      },
    ]
  }
  if (event.method === 'thread/tokenUsage/updated') {
    const usage = normalizeCodexTokenUsage(asObject(payload?.tokenUsage) ?? event.payload)
    return usage
      ? [
          {
            type: 'thread.token-usage.updated',
            ...runtimeEventBase(event, canonicalThreadId),
            payload: { usage },
          },
        ]
      : []
  }
  return (
    mapThreadStateEvent(event, canonicalThreadId, payload) ??
    THREAD_REALTIME_MAPPERS[event.method]?.(event, canonicalThreadId, payload)
  )
}

const TURN_EVENT_MAPPERS: Record<
  string,
  (
    event: ProviderEvent,
    canonicalThreadId: ThreadId,
    payload: Record<string, unknown> | undefined,
    turn: Record<string, unknown> | undefined
  ) => ReadonlyArray<ProviderRuntimeEvent>
> = {
  'turn/completed': (event, canonicalThreadId, _payload, turn) => {
    const errorMessage = asString(asObject(turn?.error)?.message)
    return runtimeEvents({
      ...runtimeEventBase(event, canonicalThreadId),
      type: 'turn.completed',
      payload: {
        state: toTurnStatus(turn?.status),
        ...(asString(turn?.stopReason) ? { stopReason: asString(turn?.stopReason) } : {}),
        ...(turn?.usage !== undefined ? { usage: turn.usage } : {}),
        ...(asObject(turn?.modelUsage) ? { modelUsage: asObject(turn?.modelUsage) } : {}),
        ...(asNumber(turn?.totalCostUsd) !== undefined
          ? { totalCostUsd: asNumber(turn?.totalCostUsd) }
          : {}),
        ...(errorMessage ? { errorMessage } : {}),
      },
    })
  },
  'turn/aborted': (event, canonicalThreadId) =>
    runtimeEvents({
      ...runtimeEventBase(event, canonicalThreadId),
      type: 'turn.aborted',
      payload: { reason: event.message ?? 'Turn aborted' },
    }),
  'turn/plan/updated': (event, canonicalThreadId, payload) =>
    runtimeEvents({
      ...runtimeEventBase(event, canonicalThreadId),
      type: 'turn.plan.updated',
      payload: {
        ...(asString(payload?.explanation) ? { explanation: asString(payload?.explanation) } : {}),
        plan: (Array.isArray(payload?.plan) ? payload.plan : [])
          .map(entry => asObject(entry))
          .filter((entry): entry is Record<string, unknown> => entry !== undefined)
          .map(entry => ({
            step: asString(entry.step) ?? 'step',
            status:
              entry.status === 'completed' || entry.status === 'inProgress'
                ? entry.status
                : 'pending',
          })),
      },
    }),
  'turn/diff/updated': (event, canonicalThreadId, payload) =>
    runtimeEvents({
      ...runtimeEventBase(event, canonicalThreadId),
      type: 'turn.diff.updated',
      payload: {
        unifiedDiff:
          asString(payload?.unifiedDiff) ??
          asString(payload?.diff) ??
          asString(payload?.patch) ??
          '',
      },
    }),
}

export function mapTurnEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): ReadonlyArray<ProviderRuntimeEvent> | undefined {
  const payload = asObject(event.payload)
  const turn = asObject(payload?.turn)
  if (event.method === 'turn/started') {
    return event.turnId
      ? [
          {
            ...runtimeEventBase(event, canonicalThreadId),
            turnId: event.turnId,
            type: 'turn.started',
            payload: {
              ...(asString(turn?.model) ? { model: asString(turn?.model) } : {}),
              ...(asString(turn?.effort) ? { effort: asString(turn?.effort) } : {}),
            },
          },
        ]
      : []
  }
  return TURN_EVENT_MAPPERS[event.method]?.(event, canonicalThreadId, payload, turn)
}
