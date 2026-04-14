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
  type CanonicalRequestType,
  type EventId,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  RuntimeRequestId,
  type ThreadId,
  type TurnId,
  type UserInputQuestion,
  type UserInputQuestionOption,
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

// Authoritative turn-end signal — upstream gates send/stop on this event.
// `session.idle` is the deprecated peer (fires at the same moment); we
// route it through this same handler by reusing the dispatcher case.
export function mapSessionTurnEnd(
  event: Extract<OpencodeEvent, { type: 'session.status' | 'session.idle' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  if (!matchesThread(ctx, event.properties.sessionID)) return []
  if (event.type === 'session.status' && event.properties.status.type !== 'idle') return []
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

/**
 * Map opencode's `permission` string (tool name, e.g. `bash`, `edit`) to our
 * canonical request type. Kept in sync with `toolLifecycleItemTypeForTool`
 * in `OpencodeAdapter.toolSummary.ts` — the mapping there is for tool
 * lifecycle item types; here we're classifying approval requests.
 */
function classifyOpencodePermission(permission: string): CanonicalRequestType {
  switch (permission) {
    case 'bash':
      return 'command_execution_approval'
    case 'edit':
    case 'write':
    case 'apply_patch':
      return 'file_change_approval'
    case 'read':
      return 'file_read_approval'
    default:
      return 'unknown'
  }
}

function summarizePermissionRequest(
  info: Extract<OpencodeEvent, { type: 'permission.asked' }>['properties']
): string | undefined {
  const firstPattern = info.patterns.find(p => p.trim().length > 0)?.trim()
  if (firstPattern) return firstPattern
  const metaTitle =
    typeof info.metadata['title'] === 'string'
      ? (info.metadata['title'] as string).trim()
      : undefined
  if (metaTitle && metaTitle.length > 0) return metaTitle
  return info.permission
}

function resolveMapperContext(
  ctx: OpencodeMapperContext,
  sessionID: string
): { turnId: TurnId | undefined } | null {
  if (!matchesThread(ctx, sessionID)) return null
  return { turnId: turnIdForSession(ctx, sessionID) ?? ctx.turnId }
}

export function mapPermissionAsked(
  event: Extract<OpencodeEvent, { type: 'permission.asked' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties
  const resolved = resolveMapperContext(ctx, info.sessionID)
  if (!resolved) return []
  const { turnId } = resolved
  const requestType = classifyOpencodePermission(info.permission)
  const detail = summarizePermissionRequest(info)
  return [
    {
      ...makeBaseForTurn(ctx, turnId, info.tool?.callID),
      requestId: RuntimeRequestId.makeUnsafe(info.id),
      type: 'request.opened',
      payload: {
        requestType,
        ...(detail ? { detail } : {}),
        args: {
          permission: info.permission,
          patterns: info.patterns,
          metadata: info.metadata,
          ...(info.tool ? { tool: info.tool } : {}),
        },
      },
      raw: opencodeRawEvent(event),
    },
  ]
}

function mapPermissionReply(
  reply: 'once' | 'always' | 'reject'
): 'accept' | 'acceptForSession' | 'decline' {
  switch (reply) {
    case 'once':
      return 'accept'
    case 'always':
      return 'acceptForSession'
    case 'reject':
      return 'decline'
  }
}

export function mapPermissionReplied(
  event: Extract<OpencodeEvent, { type: 'permission.replied' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties
  const resolved = resolveMapperContext(ctx, info.sessionID)
  if (!resolved) return []
  const { turnId } = resolved
  return [
    {
      ...makeBaseForTurn(ctx, turnId),
      requestId: RuntimeRequestId.makeUnsafe(info.requestID),
      // requestType isn't on the replied payload; we re-emit 'unknown' because
      // the resolver downstream already has the requestType from the opened
      // event and only relies on decision + requestId for correlation.
      type: 'request.resolved',
      payload: { requestType: 'unknown', decision: mapPermissionReply(info.reply) },
      raw: opencodeRawEvent(event),
    },
  ]
}

function toUserInputOption(
  option: Extract<
    OpencodeEvent,
    { type: 'question.asked' }
  >['properties']['questions'][number]['options'][number]
): UserInputQuestionOption {
  const label = option.label.trim()
  const description = option.description.trim()
  return {
    label: (label.length > 0 ? label : 'Option') as UserInputQuestionOption['label'],
    description: (description.length > 0
      ? description
      : label || 'Option') as UserInputQuestionOption['description'],
  }
}

function toUserInputQuestion(
  question: Extract<OpencodeEvent, { type: 'question.asked' }>['properties']['questions'][number],
  index: number
): UserInputQuestion {
  const header = question.header.trim()
  const prompt = question.question.trim()
  const id = `q${index}`
  return {
    id: id as UserInputQuestion['id'],
    header: (header.length > 0 ? header : `Question ${index + 1}`) as UserInputQuestion['header'],
    question: (prompt.length > 0
      ? prompt
      : header || `Question ${index + 1}`) as UserInputQuestion['question'],
    options: question.options.map(toUserInputOption),
    ...(question.multiple ? { multiSelect: true } : {}),
  }
}

export function mapQuestionAsked(
  event: Extract<OpencodeEvent, { type: 'question.asked' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties
  const resolved = resolveMapperContext(ctx, info.sessionID)
  if (!resolved) return []
  const { turnId } = resolved
  const questions = info.questions.map(toUserInputQuestion)
  return [
    {
      ...makeBaseForTurn(ctx, turnId, info.tool?.callID),
      requestId: RuntimeRequestId.makeUnsafe(info.id),
      type: 'user-input.requested',
      payload: { questions },
      raw: opencodeRawEvent(event),
    },
  ]
}

export function mapQuestionReplied(
  event: Extract<OpencodeEvent, { type: 'question.replied' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties
  const resolved = resolveMapperContext(ctx, info.sessionID)
  if (!resolved) return []
  const { turnId } = resolved
  // Downstream consumers only need the answers keyed somehow. Without the
  // original question ids the mapper can't key by question; the runtime
  // side (which has the pending map) could pass ids via partHint but we
  // keep the pure mapper ignorant and key by positional `q{index}`.
  const answers: Record<string, ReadonlyArray<string>> = {}
  info.answers.forEach((answer, index) => {
    answers[`q${index}`] = answer
  })
  return [
    {
      ...makeBaseForTurn(ctx, turnId),
      requestId: RuntimeRequestId.makeUnsafe(info.requestID),
      type: 'user-input.resolved',
      payload: { answers },
      raw: opencodeRawEvent(event),
    },
  ]
}

export function mapQuestionRejected(
  event: Extract<OpencodeEvent, { type: 'question.rejected' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties
  const resolved = resolveMapperContext(ctx, info.sessionID)
  if (!resolved) return []
  const baseEvent = {
    ...makeBaseForTurn(ctx, resolved.turnId),
    requestId: RuntimeRequestId.makeUnsafe(info.requestID),
    raw: opencodeRawEvent(event),
  } as const
  return [{ ...baseEvent, type: 'user-input.resolved', payload: { answers: {} } }]
}

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
