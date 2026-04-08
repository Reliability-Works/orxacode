import { type ProviderEvent, type ProviderRuntimeEvent, ThreadId } from '@orxa-code/contracts'

import {
  asNumber,
  asObject,
  asString,
  contentStreamKindFromMethod,
  itemDetail,
  mapItemLifecycle,
  runtimeEventBase,
  toCanonicalItemType,
  toCanonicalUserInputAnswers,
} from './CodexRuntimeEventUtils.ts'
import { runtimeEvents } from './CodexRuntimeEventMapper.shared.ts'

const ITEM_UPDATED_METHODS = new Set([
  'item/reasoning/summaryPartAdded',
  'item/commandExecution/terminalInteraction',
])
const ITEM_DELTA_METHODS = new Set([
  'item/agentMessage/delta',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
])

function itemDeltaText(event: ProviderEvent, payload: Record<string, unknown> | undefined) {
  return (
    event.textDelta ??
    asString(payload?.delta) ??
    asString(payload?.text) ??
    asString(asObject(payload?.content)?.text)
  )
}

function mapItemCompletedEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  payload: Record<string, unknown> | undefined
) {
  const source = asObject(payload?.item) ?? payload
  const itemType = source ? toCanonicalItemType(source.type ?? source.kind) : 'unknown'
  if (itemType === 'plan') {
    const detail = source ? itemDetail(source, payload ?? {}) : undefined
    return detail
      ? runtimeEvents({
          ...runtimeEventBase(event, canonicalThreadId),
          type: 'turn.proposed.completed',
          payload: { planMarkdown: detail },
        })
      : []
  }
  const completed = mapItemLifecycle(event, canonicalThreadId, 'item.completed')
  return completed ? [completed] : []
}

function mapItemStartedEvent(event: ProviderEvent, canonicalThreadId: ThreadId) {
  const started = mapItemLifecycle(event, canonicalThreadId, 'item.started')
  return started ? [started] : []
}

function mapItemUpdatedEvent(event: ProviderEvent, canonicalThreadId: ThreadId) {
  if (!ITEM_UPDATED_METHODS.has(event.method)) {
    return undefined
  }
  const updated = mapItemLifecycle(event, canonicalThreadId, 'item.updated')
  return updated ? [updated] : []
}

function mapItemDeltaEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  payload: Record<string, unknown> | undefined
) {
  const delta = itemDeltaText(event, payload)
  return delta
    ? runtimeEvents({
        ...runtimeEventBase(event, canonicalThreadId),
        type: 'content.delta',
        payload: {
          streamKind: contentStreamKindFromMethod(event.method),
          delta,
          ...(typeof payload?.contentIndex === 'number'
            ? { contentIndex: payload.contentIndex }
            : {}),
          ...(typeof payload?.summaryIndex === 'number'
            ? { summaryIndex: payload.summaryIndex }
            : {}),
        },
      })
    : []
}

function mapItemPlanDeltaEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  payload: Record<string, unknown> | undefined
) {
  const delta = itemDeltaText(event, payload)
  return delta
    ? runtimeEvents({
        ...runtimeEventBase(event, canonicalThreadId),
        type: 'turn.proposed.delta',
        payload: { delta },
      })
    : []
}

function mapItemProgressEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  payload: Record<string, unknown> | undefined
) {
  return runtimeEvents({
    ...runtimeEventBase(event, canonicalThreadId),
    type: 'tool.progress',
    payload: {
      ...(asString(payload?.toolUseId) ? { toolUseId: asString(payload?.toolUseId) } : {}),
      ...(asString(payload?.toolName) ? { toolName: asString(payload?.toolName) } : {}),
      ...(asString(payload?.summary) ? { summary: asString(payload?.summary) } : {}),
      ...(asNumber(payload?.elapsedSeconds) !== undefined
        ? { elapsedSeconds: asNumber(payload?.elapsedSeconds) }
        : {}),
    },
  })
}

function mapItemUserInputAnsweredEvent(event: ProviderEvent, canonicalThreadId: ThreadId) {
  return runtimeEvents({
    ...runtimeEventBase(event, canonicalThreadId),
    type: 'user-input.resolved',
    payload: {
      answers: toCanonicalUserInputAnswers(
        asObject(event.payload)?.answers as ReturnType<typeof toCanonicalUserInputAnswers>
      ),
    },
  })
}

function mapItemStreamEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  payload: Record<string, unknown> | undefined
) {
  return ITEM_DELTA_METHODS.has(event.method)
    ? mapItemDeltaEvent(event, canonicalThreadId, payload)
    : undefined
}

const ITEM_EVENT_MAPPERS: Record<
  string,
  (
    event: ProviderEvent,
    canonicalThreadId: ThreadId,
    payload: Record<string, unknown> | undefined
  ) => ReadonlyArray<ProviderRuntimeEvent>
> = {
  'item/started': (event, canonicalThreadId) => mapItemStartedEvent(event, canonicalThreadId),
  'item/completed': (event, canonicalThreadId, payload) =>
    mapItemCompletedEvent(event, canonicalThreadId, payload),
  'item/plan/delta': (event, canonicalThreadId, payload) =>
    mapItemPlanDeltaEvent(event, canonicalThreadId, payload),
  'item/mcpToolCall/progress': (event, canonicalThreadId, payload) =>
    mapItemProgressEvent(event, canonicalThreadId, payload),
  'item/tool/requestUserInput/answered': (event, canonicalThreadId) =>
    mapItemUserInputAnsweredEvent(event, canonicalThreadId),
}

export function mapItemEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): ReadonlyArray<ProviderRuntimeEvent> | undefined {
  const payload = asObject(event.payload)
  return (
    ITEM_EVENT_MAPPERS[event.method]?.(event, canonicalThreadId, payload) ??
    mapItemUpdatedEvent(event, canonicalThreadId) ??
    mapItemStreamEvent(event, canonicalThreadId, payload)
  )
}
