import type {
  Event as OpencodeEvent,
  FileDiff,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from '@opencode-ai/sdk/v2/client'
import type { SessionMessageBundle, SessionRuntimeSnapshot } from '@shared/ipc'

type SessionEventResult = {
  snapshot: SessionRuntimeSnapshot
  messages: SessionMessageBundle[]
  todoItems: Todo[] | undefined
  changed: boolean
}

type SessionEventContext = {
  directory: string
  sessionID: string
  snapshot: SessionRuntimeSnapshot | null
  messages: SessionMessageBundle[]
  event: OpencodeEvent
}

function createResult(
  snapshot: SessionRuntimeSnapshot,
  messages: SessionMessageBundle[],
  changed = false,
  todoItems: Todo[] | undefined = undefined
): SessionEventResult {
  return { snapshot, messages, changed, todoItems }
}

function getSessionIdFromEvent(event: OpencodeEvent) {
  const properties = event.properties as Record<string, unknown> | undefined
  if (!properties) {
    return undefined
  }
  if (typeof properties.sessionID === 'string') {
    return properties.sessionID
  }
  const info = properties.info
  if (
    info &&
    typeof info === 'object' &&
    typeof (info as { sessionID?: unknown }).sessionID === 'string'
  ) {
    return (info as { sessionID: string }).sessionID
  }
  const part = properties.part
  if (
    part &&
    typeof part === 'object' &&
    typeof (part as { sessionID?: unknown }).sessionID === 'string'
  ) {
    return (part as { sessionID: string }).sessionID
  }
  return undefined
}

function mergeMessageParts(
  previous: SessionMessageBundle['parts'],
  next: SessionMessageBundle['parts']
) {
  const merged = new Map<string, SessionMessageBundle['parts'][number]>()
  const seenFallbackKeys = new Set<string>()
  const ordered: string[] = []

  for (const part of [...previous, ...next]) {
    if (typeof part.id === 'string' && part.id.length > 0) {
      if (!merged.has(part.id)) {
        ordered.push(part.id)
      }
      merged.set(part.id, part)
      continue
    }

    const content =
      typeof (part as { content?: unknown }).content === 'string'
        ? ((part as { content?: string }).content ?? '').slice(0, 100)
        : ''
    const key = `_fb_${part.type}_${content}`
    if (!seenFallbackKeys.has(key)) {
      seenFallbackKeys.add(key)
      ordered.push(key)
    }
    merged.set(key, part)
  }

  return ordered.map(key => merged.get(key)!)
}

function messageUpdatedAt(info: SessionMessageBundle['info']) {
  const timeRecord = info.time as Record<string, unknown>
  const updated = typeof timeRecord.updated === 'number' ? timeRecord.updated : undefined
  const created = typeof timeRecord.created === 'number' ? timeRecord.created : 0
  return updated ?? created
}

function normalizeMessageBundles(items: SessionMessageBundle[]) {
  if (items.length <= 1) {
    return items
  }
  const byId = new Map<string, SessionMessageBundle>()
  for (const item of items) {
    const existing = byId.get(item.info.id)
    if (!existing) {
      byId.set(item.info.id, item)
      continue
    }
    const itemUpdatedAt = messageUpdatedAt(item.info)
    const existingUpdatedAt = messageUpdatedAt(existing.info)
    const nextInfo = itemUpdatedAt >= existingUpdatedAt ? item.info : existing.info
    byId.set(item.info.id, {
      ...item,
      info: nextInfo,
      parts: mergeMessageParts(existing.parts, item.parts),
    })
  }
  return [...byId.values()].sort((a, b) => a.info.time.created - b.info.time.created)
}

function upsertById<T extends { id: string }>(items: T[], value: T) {
  const index = items.findIndex(item => item.id === value.id)
  if (index < 0) {
    return [...items, value]
  }
  const next = [...items]
  next[index] = value
  return next
}

function removeById<T extends { id: string }>(items: T[], id: string) {
  const index = items.findIndex(item => item.id === id)
  if (index < 0) {
    return items
  }
  return [...items.slice(0, index), ...items.slice(index + 1)]
}

function upsertMessage(messages: SessionMessageBundle[], info: Message) {
  const index = messages.findIndex(bundle => bundle.info.id === info.id)
  if (index < 0) {
    return normalizeMessageBundles([...messages, { info, parts: [] }])
  }
  const next = [...messages]
  next[index] = { ...next[index], info }
  return normalizeMessageBundles(next)
}

function removeMessage(messages: SessionMessageBundle[], messageID: string) {
  return messages.filter(bundle => bundle.info.id !== messageID)
}

function upsertPart(messages: SessionMessageBundle[], part: Part) {
  const index = messages.findIndex(bundle => bundle.info.id === part.messageID)
  if (index < 0) {
    return messages
  }
  const bundle = messages[index]!
  const partIndex = bundle.parts.findIndex(item => item.id === part.id)
  const nextParts =
    partIndex < 0
      ? [...bundle.parts, part]
      : bundle.parts.map((item, currentIndex) => (currentIndex === partIndex ? part : item))
  const next = [...messages]
  next[index] = { ...bundle, parts: nextParts }
  return normalizeMessageBundles(next)
}

function removePart(messages: SessionMessageBundle[], messageID: string, partID: string) {
  const index = messages.findIndex(bundle => bundle.info.id === messageID)
  if (index < 0) {
    return messages
  }
  const bundle = messages[index]!
  const nextParts = bundle.parts.filter(part => part.id !== partID)
  const next = [...messages]
  next[index] = { ...bundle, parts: nextParts }
  return normalizeMessageBundles(next)
}

function appendPartDelta(
  messages: SessionMessageBundle[],
  messageID: string,
  partID: string,
  field: string,
  delta: string
) {
  const messageIndex = messages.findIndex(bundle => bundle.info.id === messageID)
  if (messageIndex < 0) {
    return messages
  }
  const bundle = messages[messageIndex]!
  const partIndex = bundle.parts.findIndex(part => part.id === partID)
  if (partIndex < 0) {
    return messages
  }
  const part = bundle.parts[partIndex]!
  const existing = (part as Record<string, unknown>)[field]
  if (existing !== undefined && typeof existing !== 'string') {
    return messages
  }
  const nextPart = {
    ...part,
    [field]: `${typeof existing === 'string' ? existing : ''}${delta}`,
  } as Part
  const nextParts = bundle.parts.map((item, index) => (index === partIndex ? nextPart : item))
  const next = [...messages]
  next[messageIndex] = { ...bundle, parts: nextParts }
  return normalizeMessageBundles(next)
}

function createSessionSnapshot(
  directory: string,
  sessionID: string,
  messages: SessionMessageBundle[] = []
): SessionRuntimeSnapshot {
  return {
    directory,
    sessionID,
    session: null,
    sessionStatus: undefined,
    permissions: [],
    questions: [],
    commands: [],
    messages,
    sessionDiff: [],
    executionLedger: { cursor: 0, records: [] },
    changeProvenance: { cursor: 0, records: [] },
  }
}

function applySessionCreatedOrUpdatedSnapshot(
  snapshot: SessionRuntimeSnapshot,
  event: OpencodeEvent
) {
  const info = (event.properties as { info?: Session }).info
  return info ? { ...snapshot, session: info } : null
}

function applySessionStatusSnapshot(snapshot: SessionRuntimeSnapshot, event: OpencodeEvent) {
  const props = event.properties as { status?: SessionStatus }
  return props?.status ? { ...snapshot, sessionStatus: props.status } : null
}

function applySessionIdleSnapshot(snapshot: SessionRuntimeSnapshot) {
  return { ...snapshot, sessionStatus: { type: 'idle' } as SessionStatus }
}

function applySessionErrorSnapshot(
  snapshot: SessionRuntimeSnapshot,
  event: OpencodeEvent
) {
  const props = event.properties as { error?: { message?: string } }
  return {
    ...snapshot,
    sessionStatus: {
      type: 'error',
      message: props?.error?.message,
    } as unknown as SessionStatus,
  }
}

function applySessionDiffSnapshot(snapshot: SessionRuntimeSnapshot, event: OpencodeEvent) {
  const props = event.properties as { diff?: FileDiff[] }
  return { ...snapshot, sessionDiff: props?.diff ?? [] }
}

function applySessionTodoUpdateEvent(event: OpencodeEvent): Todo[] {
  const props = event.properties as { todos?: Todo[] }
  return props?.todos ?? []
}

function applySessionPermissionAskedSnapshot(
  snapshot: SessionRuntimeSnapshot,
  event: OpencodeEvent
) {
  const permission = event.properties as PermissionRequest
  return permission?.id ? { ...snapshot, permissions: upsertById(snapshot.permissions, permission) } : null
}

function applySessionPermissionRepliedSnapshot(
  snapshot: SessionRuntimeSnapshot,
  event: OpencodeEvent
) {
  const props = event.properties as { requestID?: string }
  return props?.requestID
    ? { ...snapshot, permissions: removeById(snapshot.permissions, props.requestID) }
    : null
}

function applySessionQuestionAskedSnapshot(
  snapshot: SessionRuntimeSnapshot,
  event: OpencodeEvent
) {
  const question = event.properties as QuestionRequest
  return question?.id ? { ...snapshot, questions: upsertById(snapshot.questions, question) } : null
}

function applySessionQuestionAnsweredSnapshot(
  snapshot: SessionRuntimeSnapshot,
  event: OpencodeEvent
) {
  const props = event.properties as { requestID?: string }
  return props?.requestID
    ? { ...snapshot, questions: removeById(snapshot.questions, props.requestID) }
    : null
}

function applyMessageCreatedOrUpdated(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const info = (state.event.properties as { info?: Message }).info
  if (!info) {
    return createResult(state.snapshot, state.messages)
  }
  const messages = upsertMessage(state.messages, info)
  return createResult({ ...state.snapshot, messages }, messages, true)
}

function applyMessageRemoved(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const props = state.event.properties as { messageID?: string }
  if (!props?.messageID) {
    return createResult(state.snapshot, state.messages)
  }
  const messages = removeMessage(state.messages, props.messageID)
  return createResult({ ...state.snapshot, messages }, messages, true)
}

function applyMessagePartChanged(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const part = (state.event.properties as { part?: Part }).part
  if (!part) {
    return createResult(state.snapshot, state.messages)
  }
  const messages = upsertPart(state.messages, part)
  return createResult({ ...state.snapshot, messages }, messages, true)
}

function applyMessagePartRemoved(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const props = state.event.properties as { messageID?: string; partID?: string }
  if (!props?.messageID || !props?.partID) {
    return createResult(state.snapshot, state.messages)
  }
  const messages = removePart(state.messages, props.messageID, props.partID)
  return createResult({ ...state.snapshot, messages }, messages, true)
}

function applyMessagePartDelta(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const props = state.event.properties as {
    messageID?: string
    partID?: string
    field?: string
    delta?: string
  }
  if (!props?.messageID || !props?.partID || !props?.field || typeof props.delta !== 'string') {
    return createResult(state.snapshot, state.messages)
  }
  const messages = appendPartDelta(
    state.messages,
    props.messageID,
    props.partID,
    props.field,
    props.delta
  )
  return createResult({ ...state.snapshot, messages }, messages, true)
}

function applySessionCreatedOrUpdated(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const next = applySessionCreatedOrUpdatedSnapshot(state.snapshot, state.event)
  return next ? createResult(next, state.messages, true) : createResult(state.snapshot, state.messages)
}

function applySessionStatus(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const next = applySessionStatusSnapshot(state.snapshot, state.event)
  return next ? createResult(next, state.messages, true) : createResult(state.snapshot, state.messages)
}

function applySessionIdle(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  return createResult(applySessionIdleSnapshot(state.snapshot), state.messages, true)
}

function applySessionError(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  return createResult(applySessionErrorSnapshot(state.snapshot, state.event), state.messages, true)
}

function applySessionDiff(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const next = applySessionDiffSnapshot(state.snapshot, state.event)
  return next ? createResult(next, state.messages, true) : createResult(state.snapshot, state.messages)
}

function applyTodoUpdated(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  return createResult(state.snapshot, state.messages, false, applySessionTodoUpdateEvent(state.event))
}

function applyPermissionAsked(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const next = applySessionPermissionAskedSnapshot(state.snapshot, state.event)
  return next ? createResult(next, state.messages, true) : createResult(state.snapshot, state.messages)
}

function applyPermissionReplied(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const next = applySessionPermissionRepliedSnapshot(state.snapshot, state.event)
  return next ? createResult(next, state.messages, true) : createResult(state.snapshot, state.messages)
}

function applyQuestionAsked(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const next = applySessionQuestionAskedSnapshot(state.snapshot, state.event)
  return next ? createResult(next, state.messages, true) : createResult(state.snapshot, state.messages)
}

function applyQuestionAnswered(
  state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }
) {
  const next = applySessionQuestionAnsweredSnapshot(state.snapshot, state.event)
  return next ? createResult(next, state.messages, true) : createResult(state.snapshot, state.messages)
}

const SESSION_EVENT_HANDLERS: Record<
  string,
  (state: SessionEventContext & { snapshot: SessionRuntimeSnapshot; messages: SessionMessageBundle[] }) => SessionEventResult
> = {
  'session.created': applySessionCreatedOrUpdated,
  'session.updated': applySessionCreatedOrUpdated,
  'session.status': applySessionStatus,
  'session.idle': applySessionIdle,
  'session.error': applySessionError,
  'session.diff': applySessionDiff,
  'todo.updated': applyTodoUpdated,
  'permission.asked': applyPermissionAsked,
  'permission.replied': applyPermissionReplied,
  'question.asked': applyQuestionAsked,
  'question.replied': applyQuestionAnswered,
  'question.rejected': applyQuestionAnswered,
  'message.created': applyMessageCreatedOrUpdated,
  'message.updated': applyMessageCreatedOrUpdated,
  'message.removed': applyMessageRemoved,
  'message.part.created': applyMessagePartChanged,
  'message.part.updated': applyMessagePartChanged,
  'message.part.added': applyMessagePartChanged,
  'message.part.removed': applyMessagePartRemoved,
  'message.part.delta': applyMessagePartDelta,
}

export function createEmptyRuntimeSnapshot(
  directory: string,
  sessionID: string,
  messages: SessionMessageBundle[] = []
): SessionRuntimeSnapshot {
  return createSessionSnapshot(directory, sessionID, messages)
}

export function applyOpencodeSessionEvent(input: SessionEventContext) {
  const eventSessionID = getSessionIdFromEvent(input.event)
  if (eventSessionID && eventSessionID !== input.sessionID) {
    const snapshot = input.snapshot ?? createSessionSnapshot(input.directory, input.sessionID, input.messages)
    return createResult(snapshot, input.messages)
  }

  const snapshot = input.snapshot ?? createSessionSnapshot(input.directory, input.sessionID, input.messages)
  const handler = SESSION_EVENT_HANDLERS[String(input.event.type)]
  if (!handler) {
    return createResult(snapshot, input.messages)
  }
  return handler({ ...input, snapshot, messages: input.messages })
}
