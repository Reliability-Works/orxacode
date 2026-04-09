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
  OpencodeChildDelegation,
  OpencodeEvent,
  OpencodeMessage,
  OpencodeSession,
} from './OpencodeAdapter.types.ts'
import { PROVIDER } from './OpencodeAdapter.types.ts'
import { opencodeChildTurnId } from '../../opencodeChildThreads.ts'
import {
  mapMessagePartDelta,
  mapMessagePartRemoved,
  mapMessagePartUpdated,
} from './OpencodeAdapter.parts.ts'

export interface OpencodeEventStamp {
  readonly eventId: EventId
  readonly createdAt: string
}

export interface OpencodeMapperContext {
  readonly threadId: ThreadId
  readonly turnId: TurnId | undefined
  readonly providerSessionId: string | undefined
  readonly relatedSessionIds: ReadonlySet<string>
  readonly childDelegationsBySessionId: ReadonlyMap<string, OpencodeChildDelegation>
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

function makeBase(ctx: OpencodeMapperContext, providerItemId?: string): BaseFields {
  return makeBaseForTurn(ctx, ctx.turnId, providerItemId)
}

function runtimeItemIdFromMessageId(messageId: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(`opencode-message-${messageId}`)
}

function matchesThread(ctx: OpencodeMapperContext, sessionId: string | undefined): boolean {
  if (sessionId && ctx.relatedSessionIds.has(sessionId)) {
    return true
  }
  if (!ctx.providerSessionId) return true
  return sessionId === ctx.providerSessionId
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

export function mapSessionCreated(
  event: Extract<OpencodeEvent, { type: 'session.created' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const session: OpencodeSession = event.properties.info
  if (!matchesThread(ctx, session.id)) return []
  const turnId = turnIdForSession(ctx, session.id)
  const delegation = ctx.childDelegationsBySessionId.get(session.id)
  return [
    {
      ...makeBaseForTurn(ctx, turnId, session.id),
      type: 'session.started',
      payload: { message: `opencode session ${session.id} created` },
      raw: {
        ...opencodeRawEvent(event),
        payload: {
          ...event.properties,
          ...(delegation ? { delegation } : {}),
        },
      },
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
  const turnId = turnIdForSession(ctx, info.sessionID)
  const events: Array<ProviderRuntimeEvent> = []
  if (info.role === 'assistant') {
    events.push({
      ...makeBaseForTurn(ctx, turnId, info.id),
      itemId: runtimeItemIdFromMessageId(info.id),
      type: 'item.started',
      payload: { itemType: 'assistant_message', status: 'inProgress' },
      raw: opencodeRawEvent(event),
    })
    if (typeof info.time.completed === 'number') {
      events.push({
        ...makeBaseForTurn(ctx, turnId, info.id),
        type: 'thread.token-usage.updated',
        payload: { usage: extractUsageSnapshot(info) },
        raw: opencodeRawEvent(event),
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
  const turnId = turnIdForSession(ctx, event.properties.sessionID)
  return [
    {
      ...makeBaseForTurn(ctx, turnId, event.properties.messageID),
      itemId: runtimeItemIdFromMessageId(event.properties.messageID),
      type: 'item.updated',
      payload: { itemType: 'assistant_message', status: 'declined' },
      raw: opencodeRawEvent(event),
    },
  ]
}

export function mapSessionIdle(
  event: Extract<OpencodeEvent, { type: 'session.idle' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  if (!matchesThread(ctx, event.properties.sessionID)) return []
  const turnId = turnIdForSession(ctx, event.properties.sessionID)
  if (turnId === undefined) return []
  return [
    {
      ...makeBaseForTurn(ctx, turnId),
      type: 'turn.completed',
      payload: { state: 'completed' },
      raw: opencodeRawEvent(event),
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
  const turnId = turnIdForSession(ctx, event.properties.sessionID)
  const described = describeAuthError(event.properties.error)
  const events: Array<ProviderRuntimeEvent> = [
    {
      ...makeBaseForTurn(ctx, turnId),
      type: 'runtime.error',
      payload: { message: described.message, class: described.class },
      raw: opencodeRawEvent(event),
    },
  ]
  if (turnId !== undefined) {
    events.push({
      ...makeBaseForTurn(ctx, turnId),
      type: 'turn.completed',
      payload: { state: 'failed', errorMessage: described.message },
      raw: opencodeRawEvent(event),
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
