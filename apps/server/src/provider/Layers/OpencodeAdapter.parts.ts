import {
  ProviderItemId,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  type TurnId,
} from '@orxa-code/contracts'

import { opencodeChildTurnId } from '../../opencodeChildThreads.ts'
import {
  toolDataForPart,
  toolDetailForPart,
  toolLifecycleItemTypeForTool,
  toolTitleForPart,
} from './OpencodeAdapter.toolSummary.ts'
import type { OpencodeMapperContext } from './OpencodeAdapter.pure.ts'
import type { OpencodeEvent, OpencodePart } from './OpencodeAdapter.types.ts'
import { PROVIDER } from './OpencodeAdapter.types.ts'

interface BaseFields {
  readonly eventId: OpencodeMapperContext['nextStamp'] extends () => infer T
    ? T extends { eventId: infer E }
      ? E
      : never
    : never
  readonly provider: typeof PROVIDER
  readonly threadId: OpencodeMapperContext['threadId']
  readonly createdAt: string
  readonly turnId?: TurnId
  readonly providerRefs?: { readonly providerItemId?: ProviderItemId }
}

function makeBaseForTurn(
  ctx: OpencodeMapperContext,
  turnId: TurnId | undefined,
  providerItemId?: string
): BaseFields {
  const stamp = ctx.nextStamp()
  return {
    eventId: stamp.eventId,
    provider: PROVIDER,
    threadId: ctx.threadId,
    createdAt: stamp.createdAt,
    ...(turnId !== undefined ? { turnId } : {}),
    ...(providerItemId
      ? { providerRefs: { providerItemId: ProviderItemId.makeUnsafe(providerItemId) } }
      : {}),
  }
}

function turnIdForSession(
  ctx: OpencodeMapperContext,
  sessionId: string | undefined
): TurnId | undefined {
  if (!sessionId || sessionId === ctx.providerSessionId) {
    return ctx.turnId
  }
  return ctx.relatedSessionIds.has(sessionId) ? opencodeChildTurnId(sessionId) : ctx.turnId
}

function matchesThread(ctx: OpencodeMapperContext, sessionId: string | undefined): boolean {
  if (sessionId && ctx.relatedSessionIds.has(sessionId)) {
    return true
  }
  if (!ctx.providerSessionId) return true
  return sessionId === ctx.providerSessionId
}

function opencodeRawEvent(event: OpencodeEvent): {
  readonly source: 'opencode.sdk.event'
  readonly messageType: string
  readonly payload: unknown
} {
  return {
    source: 'opencode.sdk.event',
    messageType: event.type,
    payload: event.properties,
  }
}

function runtimeItemIdFromPartId(partId: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(`opencode-part-${partId}`)
}

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

function buildToolLifecycleUpdateEvent(input: {
  readonly ctx: OpencodeMapperContext
  readonly partId: string
  readonly sessionId: string
  readonly itemId: RuntimeItemId
  readonly itemType: ReturnType<typeof toolLifecycleItemTypeForTool>
  readonly title: string
  readonly detail: string | undefined
  readonly data: Record<string, unknown> | undefined
  readonly raw: ReturnType<typeof opencodeRawEvent>
}): ProviderRuntimeEvent | null {
  if (!input.detail && !input.data) {
    return null
  }
  return {
    ...makeBaseForTurn(input.ctx, turnIdForSession(input.ctx, input.sessionId), input.partId),
    itemId: input.itemId,
    type: 'item.updated',
    payload: {
      itemType: input.itemType,
      status: 'inProgress',
      title: input.title,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.data ? { data: input.data } : {}),
    },
    raw: input.raw,
  }
}

function buildToolLifecycleStartedEvent(input: {
  readonly ctx: OpencodeMapperContext
  readonly partId: string
  readonly sessionId: string
  readonly itemId: RuntimeItemId
  readonly itemType: ReturnType<typeof toolLifecycleItemTypeForTool>
  readonly title: string
  readonly detail: string | undefined
  readonly data: Record<string, unknown> | undefined
  readonly raw: ReturnType<typeof opencodeRawEvent>
}): ProviderRuntimeEvent {
  return {
    ...makeBaseForTurn(input.ctx, turnIdForSession(input.ctx, input.sessionId), input.partId),
    itemId: input.itemId,
    type: 'item.started',
    payload: {
      itemType: input.itemType,
      status: 'inProgress',
      title: input.title,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.data ? { data: input.data } : {}),
    },
    raw: input.raw,
  }
}

function buildToolLifecycleCompletedEvent(input: {
  readonly ctx: OpencodeMapperContext
  readonly partId: string
  readonly sessionId: string
  readonly itemId: RuntimeItemId
  readonly itemType: ReturnType<typeof toolLifecycleItemTypeForTool>
  readonly status: 'completed' | 'failed'
  readonly title: string
  readonly detail: string | undefined
  readonly data: Record<string, unknown> | undefined
  readonly raw: ReturnType<typeof opencodeRawEvent>
}): ProviderRuntimeEvent {
  return {
    ...makeBaseForTurn(input.ctx, turnIdForSession(input.ctx, input.sessionId), input.partId),
    itemId: input.itemId,
    type: 'item.completed',
    payload: {
      itemType: input.itemType,
      status: input.status,
      title: input.title,
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
      const updateEvent = buildToolLifecycleUpdateEvent(base)
      return [buildToolLifecycleStartedEvent(base), ...(updateEvent ? [updateEvent] : [])]
    }
    case 'completed':
      return [buildToolLifecycleCompletedEvent({ ...base, status: 'completed' })]
    case 'error':
      return [
        buildToolLifecycleCompletedEvent({
          ...base,
          status: 'failed',
          detail: part.state.error.length > 0 ? part.state.error : detail,
        }),
      ]
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
  const turnId = turnIdForSession(ctx, part.sessionID)
  return [
    {
      ...makeBaseForTurn(ctx, turnId, part.id),
      itemId,
      type: 'item.started',
      payload: {
        itemType: 'collab_agent_tool_call',
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
      },
      raw: opencodeRawEvent(event),
    },
  ]
}

function textOrReasoningPartEvents(
  part: Extract<OpencodePart, { type: 'text' | 'reasoning' }>,
  ctx: OpencodeMapperContext,
  event: Extract<OpencodeEvent, { type: 'message.part.updated' }>
): ReadonlyArray<ProviderRuntimeEvent> {
  const itemId = runtimeItemIdFromPartId(part.id)
  const itemType = canonicalPartItemType(part)
  const ended = part.time?.end !== undefined
  const turnId = turnIdForSession(ctx, part.sessionID)
  return [
    {
      ...makeBaseForTurn(ctx, turnId, part.id),
      itemId,
      type: ended ? 'item.completed' : 'item.updated',
      payload: {
        itemType,
        status: ended ? 'completed' : 'inProgress',
        ...(part.type === 'text' && part.text.length > 0 ? { detail: part.text } : {}),
        ...(part.type === 'reasoning' && part.text.length > 0 ? { detail: part.text } : {}),
      },
      raw: opencodeRawEvent(event),
    },
  ]
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
  const turnId = turnIdForSession(ctx, event.properties.sessionID)
  return [
    {
      ...makeBaseForTurn(ctx, turnId, event.properties.partID),
      itemId: runtimeItemIdFromPartId(event.properties.partID),
      type: 'item.updated',
      payload: { itemType: 'unknown', status: 'declined' },
      raw: opencodeRawEvent(event),
    },
  ]
}
