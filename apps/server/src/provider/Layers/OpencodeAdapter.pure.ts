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
  type ProviderRuntimeEvent,
  RuntimeItemId,
  type ThreadId,
  type ToolLifecycleItemType,
  type TurnId,
} from '@orxa-code/contracts'

import type {
  OpencodeChildDelegation,
  OpencodeEvent,
  OpencodeMessage,
  OpencodeSession,
} from './OpencodeAdapter.types.ts'
import { lookupModelContextWindow } from '@orxa-code/shared/modelContextWindow'

import {
  mapMessagePartDelta,
  mapMessagePartRemoved,
  mapMessagePartUpdated,
} from './OpencodeAdapter.parts.ts'
import {
  makeBaseForTurn,
  matchesThread,
  opencodeRawEvent,
  resolveMapperContext,
  runtimeItemIdFromPartId,
  turnIdForSession,
  type BaseFields,
} from './OpencodeAdapter.shared.ts'

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
  // Shared mutable set tracked by the per-turn state. Deltas stamp part ids
  // here as they stream so `message.part.updated` snapshots can skip the
  // intermediate in-progress redelivery. Optional because the abort-path
  // builds ad-hoc contexts outside a turn.
  readonly streamedPartIds?: Set<string>
  // Mutable flag shared with the per-turn runtime state. Lets
  // `mapMessageUpdated` emit one early `thread.token-usage.updated` so the
  // composer meter shows the context window before the assistant message
  // finishes. Shaped as a one-element ref so the pure mapper can flip it
  // without reaching into the Effect runtime.
  readonly contextWindowRef?: { emitted: boolean }
}

function makeBase(ctx: OpencodeMapperContext, providerItemId?: string): BaseFields {
  return makeBaseForTurn(ctx, ctx.turnId, providerItemId)
}

function runtimeItemIdFromMessageId(messageId: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(`opencode-message-${messageId}`)
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
  readonly maxTokens?: number
} {
  const tokens = info.tokens
  const used =
    (typeof tokens.input === 'number' ? tokens.input : 0) +
    (typeof tokens.output === 'number' ? tokens.output : 0) +
    (typeof tokens.reasoning === 'number' ? tokens.reasoning : 0)
  // Opencode's per-message payload omits the model's context limit. Look it
  // up in the static registry so the composer's "% used" meter shows a
  // percentage instead of a raw token count.
  const maxTokens = lookupModelContextWindow(info.modelID)
  return { usedTokens: used, ...(typeof maxTokens === 'number' ? { maxTokens } : {}) }
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
    if (ctx.contextWindowRef && !ctx.contextWindowRef.emitted) {
      const eager = extractUsageSnapshot(info)
      if (typeof eager.maxTokens === 'number') {
        ctx.contextWindowRef.emitted = true
        events.push({
          ...makeBaseForTurn(ctx, turnId, info.id),
          type: 'thread.token-usage.updated',
          payload: { usage: eager },
          raw: opencodeRawEvent(event),
        })
      }
    }
    if (typeof info.time.completed === 'number') {
      events.push({
        ...makeBaseForTurn(ctx, turnId, info.id),
        type: 'thread.token-usage.updated',
        payload: { usage: extractUsageSnapshot(info) },
        raw: opencodeRawEvent(event),
      })
      // turn-end is `session.status({type:'idle'})`; per-message
      // `time.completed` fires too early for multi-step tool turns.
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

// Substrings (lowercased) in a `session.status{type:'retry'}` message that
// signal a permanent failure. Opencode will otherwise keep retrying forever,
// burning a turn without ever surfacing the real reason. When matched we
// promote the retry to `turn.completed{state:'failed'}` so the UI can show
// the error and unlock the composer.
const FATAL_RETRY_TOKENS = [
  'insufficient balance',
  'invalid api key',
  'invalid_api_key',
  'unknown model',
  'model not found',
  'unauthorized',
  'authentication',
  'forbidden',
  'rate limit exceeded',
  'quota',
] as const

export function detectFatalRetryMessage(message: string): string | null {
  const lower = message.toLowerCase()
  return FATAL_RETRY_TOKENS.find(token => lower.includes(token)) ?? null
}

// Authoritative turn-end signal — upstream gates send/stop on this event.
// `session.idle` is the deprecated peer (fires at the same moment); we
// route it through this same handler by reusing the dispatcher case. The
// `session.status{type:'retry'}` branch promotes fatal retry messages into
// terminal `turn.failed` so the composer doesn't hang on a dead key.
export function mapSessionTurnEnd(
  event: Extract<OpencodeEvent, { type: 'session.status' | 'session.idle' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  if (!matchesThread(ctx, event.properties.sessionID)) return []
  const turnId = turnIdForSession(ctx, event.properties.sessionID)
  if (turnId === undefined) return []
  if (event.type === 'session.status') {
    const status = event.properties.status
    if (status.type === 'retry') {
      if (detectFatalRetryMessage(status.message) === null) return []
      return [
        {
          ...makeBaseForTurn(ctx, turnId),
          type: 'turn.completed',
          payload: {
            state: 'failed',
            errorMessage: `Opencode halted retries: ${status.message}`,
          },
          raw: opencodeRawEvent(event),
        },
      ]
    }
    if (status.type !== 'idle') return []
  }
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

import {
  mapQuestionAsked,
  mapQuestionReplied,
  mapQuestionRejected,
} from './OpencodeAdapter.pure.questions.ts'
import { mapPermissionAsked, mapPermissionReplied } from './OpencodeAdapter.pure.permissions.ts'
export { mapQuestionAsked, mapQuestionReplied, mapQuestionRejected }
export { mapPermissionAsked, mapPermissionReplied }

export function mapSessionCompacted(
  event: Extract<OpencodeEvent, { type: 'session.compacted' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties
  const resolved = resolveMapperContext(ctx, info.sessionID)
  if (!resolved) return []
  const sessionConfiguredEvent = {
    ...makeBaseForTurn(ctx, resolved.turnId),
    type: 'session.configured' as const,
    payload: { config: { event: 'session.compacted', sessionID: info.sessionID } },
    raw: opencodeRawEvent(event),
  }
  return [sessionConfiguredEvent]
}

function mapTodoStatus(raw: string): 'pending' | 'inProgress' | 'completed' {
  switch (raw) {
    case 'in_progress':
      return 'inProgress'
    case 'completed':
    case 'cancelled':
      return 'completed'
    default:
      return 'pending'
  }
}

export function mapTodoUpdated(
  event: Extract<OpencodeEvent, { type: 'todo.updated' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  if (!matchesThread(ctx, event.properties.sessionID)) return []
  const turnId = turnIdForSession(ctx, event.properties.sessionID) ?? ctx.turnId
  if (turnId === undefined) return []
  const plan = event.properties.todos
    .map(todo => {
      const step = todo.content.trim()
      if (step.length === 0) return null
      return { step, status: mapTodoStatus(todo.status) }
    })
    .filter(
      (entry): entry is { step: string; status: 'pending' | 'inProgress' | 'completed' } =>
        entry !== null
    )
  if (plan.length === 0) return []
  return [
    {
      ...makeBaseForTurn(ctx, turnId),
      type: 'turn.plan.updated',
      payload: { plan },
      raw: opencodeRawEvent(event),
    },
  ]
}

export interface InFlightToolPart {
  readonly partId: string
  readonly itemType: ToolLifecycleItemType
}

/**
 * Emit terminal `item.completed{status:'declined'}` events for every tool
 * call still marked in-flight at abort time. Without these the UI leaves
 * tool spinners running forever because opencode never sends the tool's
 * `completed`/`error` state transition after a cancel. Callers pass the
 * tracked set from the per-turn runtime state; order matches insertion so
 * the newest in-flight tool closes first (matches the UI's visual stack).
 */
export function mapInterruptedToolCalls(
  inFlight: ReadonlyArray<InFlightToolPart>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  if (ctx.turnId === undefined || inFlight.length === 0) return []
  return inFlight.map(entry => ({
    ...makeBaseForTurn(ctx, ctx.turnId, entry.partId),
    itemId: runtimeItemIdFromPartId(entry.partId),
    type: 'item.completed' as const,
    payload: {
      itemType: entry.itemType,
      status: 'declined' as const,
      detail: 'Tool call interrupted.',
    },
  }))
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
  'session.status',
  'session.error',
  'session.compacted',
  'message.updated',
  'message.removed',
  'message.part.updated',
  'message.part.delta',
  'message.part.removed',
  'todo.updated',
  'permission.asked',
  'permission.replied',
  'question.asked',
  'question.replied',
  'question.rejected',
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
    case 'session.status':
      return mapSessionTurnEnd(event, ctx)
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
    case 'todo.updated':
      return mapTodoUpdated(event, ctx)
    case 'permission.asked':
      return mapPermissionAsked(event, ctx)
    case 'permission.replied':
      return mapPermissionReplied(event, ctx)
    case 'question.asked':
      return mapQuestionAsked(event, ctx)
    case 'question.replied':
      return mapQuestionReplied(event, ctx)
    case 'question.rejected':
      return mapQuestionRejected(event, ctx)
    case 'session.compacted':
      return mapSessionCompacted(event, ctx)
    default:
      return []
  }
}
