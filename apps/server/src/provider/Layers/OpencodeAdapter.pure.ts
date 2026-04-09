/**
 * Pure opencode event mapper.
 *
 * Translates opencode SDK `Event` payloads into `ProviderRuntimeEvent`s that
 * downstream orchestration can consume opaquely. Stateless on purpose: every
 * helper is a function of (event, context) with no Effect imports, no
 * ambient time source, and no SDK client. The f04/f05 runtime layer is
 * responsible for plumbing the session context (threadId + current turnId)
 * and stamping each produced event with an `eventId` + `createdAt` pair via
 * the caller-supplied `nextStamp` factory.
 *
 * A single opencode event can fan out into multiple runtime events (e.g. a
 * `message.part.updated` for a completed tool call produces both an
 * `item.completed` and a tool summary in downstream plans), so the mapper
 * returns a `ReadonlyArray`. Unknown / unhandled events map to an empty
 * array — the runtime layer is free to log them at debug level.
 *
 * @module OpencodeAdapter.pure
 */
import {
  type EventId,
  ProviderItemId,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  type ThreadId,
  type TurnId,
} from '@orxa-code/contracts'

import type {
  OpencodeEvent,
  OpencodeMessage,
  OpencodePart,
  OpencodeSession,
} from './OpencodeAdapter.types.ts'
import { PROVIDER } from './OpencodeAdapter.types.ts'

export interface OpencodeEventStamp {
  readonly eventId: EventId
  readonly createdAt: string
}

export interface OpencodeMapperContext {
  readonly threadId: ThreadId
  readonly turnId: TurnId | undefined
  readonly providerSessionId: string | undefined
  readonly nextStamp: () => OpencodeEventStamp
}

interface BaseFields {
  readonly eventId: EventId
  readonly provider: typeof PROVIDER
  readonly threadId: ThreadId
  readonly createdAt: string
  readonly turnId?: TurnId
  readonly providerRefs?: { readonly providerItemId?: ProviderItemId }
}

function makeBase(ctx: OpencodeMapperContext, providerItemId?: string): BaseFields {
  const stamp = ctx.nextStamp()
  return {
    eventId: stamp.eventId,
    provider: PROVIDER,
    threadId: ctx.threadId,
    createdAt: stamp.createdAt,
    ...(ctx.turnId !== undefined ? { turnId: ctx.turnId } : {}),
    ...(providerItemId
      ? { providerRefs: { providerItemId: ProviderItemId.makeUnsafe(providerItemId) } }
      : {}),
  }
}

function runtimeItemIdFromPartId(partId: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(`opencode-part-${partId}`)
}

function runtimeItemIdFromMessageId(messageId: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(`opencode-message-${messageId}`)
}

function matchesThread(ctx: OpencodeMapperContext, sessionId: string | undefined): boolean {
  if (!ctx.providerSessionId) return true
  return sessionId === ctx.providerSessionId
}

export function mapSessionCreated(
  event: Extract<OpencodeEvent, { type: 'session.created' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const session: OpencodeSession = event.properties.info
  if (ctx.providerSessionId && session.id !== ctx.providerSessionId) return []
  return [
    {
      ...makeBase(ctx, session.id),
      type: 'session.started',
      payload: { message: `opencode session ${session.id} created` },
    },
  ]
}

function extractUsageSnapshot(info: Extract<OpencodeMessage, { role: 'assistant' }>): {
  readonly usedTokens: number
} {
  const tokens = info.tokens
  const used =
    (typeof tokens.input === 'number' ? tokens.input : 0) +
    (typeof tokens.output === 'number' ? tokens.output : 0) +
    (typeof tokens.reasoning === 'number' ? tokens.reasoning : 0)
  return { usedTokens: used }
}

export function mapMessageUpdated(
  event: Extract<OpencodeEvent, { type: 'message.updated' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties.info
  if (!matchesThread(ctx, info.sessionID)) return []
  const events: Array<ProviderRuntimeEvent> = []
  if (info.role === 'assistant') {
    events.push({
      ...makeBase(ctx, info.id),
      itemId: runtimeItemIdFromMessageId(info.id),
      type: 'item.started',
      payload: { itemType: 'assistant_message', status: 'inProgress' },
    })
    if (typeof info.time.completed === 'number') {
      events.push({
        ...makeBase(ctx, info.id),
        type: 'thread.token-usage.updated',
        payload: { usage: extractUsageSnapshot(info) },
      })
    }
  }
  return events
}

export function mapMessageRemoved(
  event: Extract<OpencodeEvent, { type: 'message.removed' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  if (!matchesThread(ctx, event.properties.sessionID)) return []
  return [
    {
      ...makeBase(ctx, event.properties.messageID),
      itemId: runtimeItemIdFromMessageId(event.properties.messageID),
      type: 'item.updated',
      payload: { itemType: 'assistant_message', status: 'declined' },
    },
  ]
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

function toolPartEvents(
  part: Extract<OpencodePart, { type: 'tool' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const itemId = runtimeItemIdFromPartId(part.id)
  const title = part.tool
  switch (part.state.status) {
    case 'pending':
    case 'running':
      return [
        {
          ...makeBase(ctx, part.id),
          itemId,
          type: 'item.started',
          payload: { itemType: 'mcp_tool_call', status: 'inProgress', title },
        },
      ]
    case 'completed':
      return [
        {
          ...makeBase(ctx, part.id),
          itemId,
          type: 'item.completed',
          payload: { itemType: 'mcp_tool_call', status: 'completed', title },
        },
      ]
    case 'error':
      return [
        {
          ...makeBase(ctx, part.id),
          itemId,
          type: 'item.completed',
          payload: {
            itemType: 'mcp_tool_call',
            status: 'failed',
            title,
            detail: part.state.error.length > 0 ? part.state.error : undefined,
          },
        },
      ]
    default:
      return []
  }
}

function textOrReasoningPartEvents(
  part: Extract<OpencodePart, { type: 'text' | 'reasoning' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const itemId = runtimeItemIdFromPartId(part.id)
  const itemType = canonicalPartItemType(part)
  const ended = part.time?.end !== undefined
  return [
    {
      ...makeBase(ctx, part.id),
      itemId,
      type: ended ? 'item.completed' : 'item.updated',
      payload: {
        itemType,
        status: ended ? 'completed' : 'inProgress',
        ...(part.type === 'text' && part.text.length > 0 ? { detail: part.text } : {}),
        ...(part.type === 'reasoning' && part.text.length > 0 ? { detail: part.text } : {}),
      },
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
    return textOrReasoningPartEvents(part, ctx)
  }
  if (part.type === 'tool') {
    return toolPartEvents(part, ctx)
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
  const partType = partHint?.partType
  const streamKind = streamKindForField(event.properties.field, partType)
  if (streamKind === 'unknown') return []
  return [
    {
      ...makeBase(ctx, event.properties.partID),
      itemId: runtimeItemIdFromPartId(event.properties.partID),
      type: 'content.delta',
      payload: { streamKind, delta: event.properties.delta },
    },
  ]
}

export function mapMessagePartRemoved(
  event: Extract<OpencodeEvent, { type: 'message.part.removed' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  if (!matchesThread(ctx, event.properties.sessionID)) return []
  return [
    {
      ...makeBase(ctx, event.properties.partID),
      itemId: runtimeItemIdFromPartId(event.properties.partID),
      type: 'item.updated',
      payload: { itemType: 'unknown', status: 'declined' },
    },
  ]
}

export function mapSessionIdle(
  event: Extract<OpencodeEvent, { type: 'session.idle' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  if (!matchesThread(ctx, event.properties.sessionID)) return []
  if (ctx.turnId === undefined) return []
  return [
    {
      ...makeBase(ctx),
      type: 'turn.completed',
      payload: { state: 'completed' },
    },
  ]
}

function describeAuthError(
  error: Extract<OpencodeEvent, { type: 'session.error' }>['properties']['error']
): { readonly message: string; readonly class: 'provider_error' | 'transport_error' } {
  if (!error) return { message: 'opencode session error', class: 'provider_error' }
  const data = error.data as { readonly message?: unknown }
  const message =
    typeof data.message === 'string' && data.message.length > 0 ? data.message : error.name
  const errorClass: 'provider_error' | 'transport_error' =
    error.name === 'APIError' ? 'transport_error' : 'provider_error'
  return { message, class: errorClass }
}

export function mapSessionError(
  event: Extract<OpencodeEvent, { type: 'session.error' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  if (!matchesThread(ctx, event.properties.sessionID)) return []
  const described = describeAuthError(event.properties.error)
  const events: Array<ProviderRuntimeEvent> = [
    {
      ...makeBase(ctx),
      type: 'runtime.error',
      payload: { message: described.message, class: described.class },
    },
  ]
  if (ctx.turnId !== undefined) {
    events.push({
      ...makeBase(ctx),
      type: 'turn.completed',
      payload: { state: 'failed', errorMessage: described.message },
    })
  }
  return events
}

export function mapTurnAbort(
  reason: string,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  if (ctx.turnId === undefined) return []
  return [
    {
      ...makeBase(ctx),
      type: 'turn.aborted',
      payload: { reason },
    },
  ]
}

const HANDLED_EVENT_TYPES = new Set<OpencodeEvent['type']>([
  'session.created',
  'session.idle',
  'session.error',
  'message.updated',
  'message.removed',
  'message.part.updated',
  'message.part.delta',
  'message.part.removed',
])

export function isHandledOpencodeEvent(event: OpencodeEvent): boolean {
  return HANDLED_EVENT_TYPES.has(event.type)
}

export function mapOpencodeEvent(
  event: OpencodeEvent,
  ctx: OpencodeMapperContext,
  partHint?: { readonly partId: string; readonly partType: string }
): ReadonlyArray<ProviderRuntimeEvent> {
  switch (event.type) {
    case 'session.created':
      return mapSessionCreated(event, ctx)
    case 'session.idle':
      return mapSessionIdle(event, ctx)
    case 'session.error':
      return mapSessionError(event, ctx)
    case 'message.updated':
      return mapMessageUpdated(event, ctx)
    case 'message.removed':
      return mapMessageRemoved(event, ctx)
    case 'message.part.updated':
      return mapMessagePartUpdated(event, ctx)
    case 'message.part.delta':
      return mapMessagePartDelta(event, ctx, partHint)
    case 'message.part.removed':
      return mapMessagePartRemoved(event, ctx)
    default:
      return []
  }
}
