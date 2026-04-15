import {
  type RuntimeItemId,
  type ProviderRuntimeEvent,
  type ToolLifecycleItemType,
} from '@orxa-code/contracts'
import {
  toolDataForPart,
  toolDetailForPart,
  toolLifecycleItemTypeForTool,
  toolTitleForPart,
} from './OpencodeAdapter.toolSummary.ts'
import type { OpencodeMapperContext } from './OpencodeAdapter.pure.ts'
import {
  makeBaseForTurn,
  matchesThread,
  opencodeRawEvent,
  runtimeItemIdFromPartId,
  turnIdForSession,
} from './OpencodeAdapter.shared.ts'
import type { OpencodeEvent, OpencodePart } from './OpencodeAdapter.types.ts'

function canonicalPartItemType(
  part: OpencodePart
): 'assistant_message' | 'reasoning' | 'mcp_tool_call' | 'unknown' {
  switch (part.type) {
    case 'text':
      return 'assistant_message'
    case 'reasoning':
      return 'reasoning'
    case 'tool':
      return 'mcp_tool_call'
    default:
      return 'unknown'
  }
}

function buildPartItemEvent(input: {
  readonly ctx: OpencodeMapperContext
  readonly partId: string
  readonly sessionId: string
  readonly itemId: RuntimeItemId
  readonly itemType: ToolLifecycleItemType | ReturnType<typeof canonicalPartItemType>
  readonly eventType: 'item.started' | 'item.updated' | 'item.completed'
  readonly status: 'inProgress' | 'completed' | 'failed' | 'declined'
  readonly title?: string
  readonly detail: string | undefined
  readonly data: Record<string, unknown> | undefined
  readonly raw: ReturnType<typeof opencodeRawEvent>
}): ProviderRuntimeEvent | null {
  if (
    input.eventType === 'item.updated' &&
    input.status === 'inProgress' &&
    !input.detail &&
    !input.data
  ) {
    return null
  }
  return {
    ...makeBaseForTurn(input.ctx, turnIdForSession(input.ctx, input.sessionId), input.partId),
    itemId: input.itemId,
    type: input.eventType,
    payload: {
      itemType: input.itemType,
      status: input.status,
      ...(input.title ? { title: input.title } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.data ? { data: input.data } : {}),
    },
    raw: input.raw,
  }
}

function toolPartEvents(
  part: Extract<OpencodePart, { type: 'tool' }>,
  ctx: OpencodeMapperContext,
  event: Extract<OpencodeEvent, { type: 'message.part.updated' }>
): ReadonlyArray<ProviderRuntimeEvent> {
  const itemId = runtimeItemIdFromPartId(part.id)
  const itemType = toolLifecycleItemTypeForTool(part.tool)
  const title = toolTitleForPart(part)
  const detail = toolDetailForPart(part)
  const data = toolDataForPart(part)
  const raw = opencodeRawEvent(event)
  const base = {
    ctx,
    partId: part.id,
    sessionId: part.sessionID,
    itemId,
    itemType,
    title,
    detail,
    data,
    raw,
  } as const
  switch (part.state.status) {
    case 'pending':
    case 'running': {
      const updateEvent = buildPartItemEvent({
        ...base,
        eventType: 'item.updated',
        status: 'inProgress',
      })
      const startedEvent = buildPartItemEvent({
        ...base,
        eventType: 'item.started',
        status: 'inProgress',
      })
      return startedEvent ? [startedEvent, ...(updateEvent ? [updateEvent] : [])] : []
    }
    case 'completed':
      return [
        buildPartItemEvent({ ...base, eventType: 'item.completed', status: 'completed' }),
      ].filter((event): event is ProviderRuntimeEvent => event !== null)
    case 'error':
      return [
        buildPartItemEvent({
          ...base,
          eventType: 'item.completed',
          status: 'failed',
          detail: part.state.error.length > 0 ? part.state.error : detail,
        }),
      ].filter((event): event is ProviderRuntimeEvent => event !== null)
    default:
      return []
  }
}

function subtaskPartEvents(
  part: Extract<OpencodePart, { type: 'subtask' }>,
  ctx: OpencodeMapperContext,
  event: Extract<OpencodeEvent, { type: 'message.part.updated' }>
): ReadonlyArray<ProviderRuntimeEvent> {
  const itemId = runtimeItemIdFromPartId(part.id)
  return [
    buildPartItemEvent({
      ctx,
      partId: part.id,
      sessionId: part.sessionID,
      itemId,
      itemType: 'collab_agent_tool_call',
      eventType: 'item.started',
      status: 'inProgress',
      title: part.agent,
      detail: part.description || part.prompt,
      data: {
        item: {
          agent_label: part.agent,
          prompt: part.prompt,
          description: part.description,
          ...(part.command ? { command: part.command } : {}),
          ...(part.model ? { model: part.model } : {}),
        },
      },
      raw: opencodeRawEvent(event),
    }),
  ].filter((runtimeEvent): runtimeEvent is ProviderRuntimeEvent => runtimeEvent !== null)
}

function textOrReasoningPartEvents(
  part: Extract<OpencodePart, { type: 'text' | 'reasoning' }>,
  ctx: OpencodeMapperContext,
  event: Extract<OpencodeEvent, { type: 'message.part.updated' }>
): ReadonlyArray<ProviderRuntimeEvent> {
  const itemId = runtimeItemIdFromPartId(part.id)
  const itemType = canonicalPartItemType(part)
  const ended = part.time?.end !== undefined
  // Dedup: when this part has already been streaming via `message.part.delta`
  // events, the intermediate in-progress snapshot redelivers the full
  // cumulative text and causes the renderer to double-append. Skip it. The
  // terminal `completed` snapshot is still emitted so consumers can persist
  // the authoritative final text.
  if (!ended && ctx.streamedPartIds?.has(part.id)) return []
  return [
    buildPartItemEvent({
      ctx,
      partId: part.id,
      sessionId: part.sessionID,
      itemId,
      itemType,
      eventType: ended ? 'item.completed' : 'item.updated',
      status: ended ? 'completed' : 'inProgress',
      detail: part.text.length > 0 ? part.text : undefined,
      data: undefined,
      raw: opencodeRawEvent(event),
    }),
  ].filter((runtimeEvent): runtimeEvent is ProviderRuntimeEvent => runtimeEvent !== null)
}

export function mapMessagePartUpdated(
  event: Extract<OpencodeEvent, { type: 'message.part.updated' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const part = event.properties.part
  if (!matchesThread(ctx, part.sessionID)) return []
  if (part.type === 'text' || part.type === 'reasoning') {
    return textOrReasoningPartEvents(part, ctx, event)
  }
  if (part.type === 'tool') {
    return toolPartEvents(part, ctx, event)
  }
  if (part.type === 'subtask') {
    return subtaskPartEvents(part, ctx, event)
  }
  return []
}

function streamKindForField(
  field: string,
  partType: string | undefined
): 'assistant_text' | 'reasoning_text' | 'unknown' {
  if (field === 'text' && partType === 'reasoning') return 'reasoning_text'
  if (field === 'text') return 'assistant_text'
  return 'unknown'
}

export function mapMessagePartDelta(
  event: Extract<OpencodeEvent, { type: 'message.part.delta' }>,
  ctx: OpencodeMapperContext,
  partHint?: { readonly partId: string; readonly partType: string }
): ReadonlyArray<ProviderRuntimeEvent> {
  if (!matchesThread(ctx, event.properties.sessionID)) return []
  const turnId = turnIdForSession(ctx, event.properties.sessionID)
  const partType = partHint?.partType
  const streamKind = streamKindForField(event.properties.field, partType)
  if (streamKind === 'unknown') return []
  ctx.streamedPartIds?.add(event.properties.partID)
  return [
    {
      ...makeBaseForTurn(ctx, turnId, event.properties.partID),
      itemId: runtimeItemIdFromPartId(event.properties.partID),
      type: 'content.delta',
      payload: { streamKind, delta: event.properties.delta },
      raw: opencodeRawEvent(event),
    },
  ]
}

export function mapMessagePartRemoved(
  event: Extract<OpencodeEvent, { type: 'message.part.removed' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  if (!matchesThread(ctx, event.properties.sessionID)) return []
  return [
    buildPartItemEvent({
      ctx,
      partId: event.properties.partID,
      sessionId: event.properties.sessionID,
      itemId: runtimeItemIdFromPartId(event.properties.partID),
      itemType: 'unknown',
      eventType: 'item.updated',
      status: 'declined',
      detail: undefined,
      data: undefined,
      raw: opencodeRawEvent(event),
    }),
  ].filter((runtimeEvent): runtimeEvent is ProviderRuntimeEvent => runtimeEvent !== null)
}
