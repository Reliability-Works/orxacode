import type {
  Event as OpencodeEvent,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
} from '@opencode-ai/sdk/v2/client'
import type { ProjectBootstrap, SessionMessageBundle } from '@shared/ipc'
import {
  applyOpencodeSessionEvent,
  createEmptyRuntimeSnapshot,
} from './opencode-event-reducer-session'

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

export function normalizeMessageBundles(items: SessionMessageBundle[]) {
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

function sortSessionsByUpdated(sessions: Session[]) {
  return [...sessions].sort((left, right) => right.time.updated - left.time.updated)
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

function applyProjectSessionCreatedOrUpdatedEvent(project: ProjectBootstrap, event: OpencodeEvent) {
  const info = (event.properties as { info?: Session }).info
  if (!info) {
    return project
  }
  const sessions = sortSessionsByUpdated(upsertById(project.sessions, info))
  const sessionStatus = { ...project.sessionStatus }
  if (info.time.archived) {
    delete sessionStatus[info.id]
    return {
      ...project,
      sessions: sessions.filter(session => session.id !== info.id),
      sessionStatus,
    }
  }
  return {
    ...project,
    sessions,
  }
}

function applyProjectSessionDeletedEvent(project: ProjectBootstrap, event: OpencodeEvent) {
  const info = (event.properties as { info?: Session }).info
  if (!info) {
    return project
  }
  const sessionStatus = { ...project.sessionStatus }
  delete sessionStatus[info.id]
  return {
    ...project,
    sessions: project.sessions.filter(session => session.id !== info.id),
    sessionStatus,
  }
}

function applyProjectSessionStatusEvent(project: ProjectBootstrap, event: OpencodeEvent) {
  const props = event.properties as { sessionID?: string; status?: SessionStatus }
  if (!props?.sessionID || !props.status) {
    return project
  }
  return {
    ...project,
    sessionStatus: {
      ...project.sessionStatus,
      [props.sessionID]: props.status,
    },
  }
}

function applyProjectSessionIdleEvent(project: ProjectBootstrap, event: OpencodeEvent) {
  const sessionID = (event.properties as { sessionID?: string }).sessionID
  if (!sessionID) {
    return project
  }
  return {
    ...project,
    sessionStatus: {
      ...project.sessionStatus,
      [sessionID]: { type: 'idle' } as SessionStatus,
    },
  }
}

function applyProjectSessionErrorEvent(project: ProjectBootstrap, event: OpencodeEvent) {
  const props = event.properties as { sessionID?: string; error?: { message?: string } }
  if (!props?.sessionID) {
    return project
  }
  return {
    ...project,
    sessionStatus: {
      ...project.sessionStatus,
      [props.sessionID]: {
        type: 'error',
        message: props.error?.message,
      } as unknown as SessionStatus,
    },
  }
}

function applyProjectPermissionAskedEvent(project: ProjectBootstrap, event: OpencodeEvent) {
  const permission = event.properties as PermissionRequest
  if (!permission?.id) {
    return project
  }
  return {
    ...project,
    permissions: upsertById(project.permissions, permission),
  }
}

function applyProjectPermissionRepliedEvent(project: ProjectBootstrap, event: OpencodeEvent) {
  const props = event.properties as { requestID?: string }
  if (!props?.requestID) {
    return project
  }
  return {
    ...project,
    permissions: removeById(project.permissions, props.requestID),
  }
}

function applyProjectQuestionAskedEvent(project: ProjectBootstrap, event: OpencodeEvent) {
  const question = event.properties as QuestionRequest
  if (!question?.id) {
    return project
  }
  return {
    ...project,
    questions: upsertById(project.questions, question),
  }
}

function applyProjectQuestionAnsweredEvent(project: ProjectBootstrap, event: OpencodeEvent) {
  const props = event.properties as { requestID?: string }
  if (!props?.requestID) {
    return project
  }
  return {
    ...project,
    questions: removeById(project.questions, props.requestID),
  }
}

export function applyOpencodeProjectEvent(
  project: ProjectBootstrap | null | undefined,
  event: OpencodeEvent
) {
  if (!project) {
    return null
  }
  switch (String(event.type)) {
    case 'session.created':
    case 'session.updated':
      return applyProjectSessionCreatedOrUpdatedEvent(project, event)
    case 'session.deleted':
      return applyProjectSessionDeletedEvent(project, event)
    case 'session.status':
      return applyProjectSessionStatusEvent(project, event)
    case 'session.idle':
      return applyProjectSessionIdleEvent(project, event)
    case 'session.error':
      return applyProjectSessionErrorEvent(project, event)
    case 'permission.asked':
      return applyProjectPermissionAskedEvent(project, event)
    case 'permission.replied':
      return applyProjectPermissionRepliedEvent(project, event)
    case 'question.asked':
      return applyProjectQuestionAskedEvent(project, event)
    case 'question.replied':
    case 'question.rejected':
      return applyProjectQuestionAnsweredEvent(project, event)
    default:
      return project
  }
}

export { applyOpencodeSessionEvent, createEmptyRuntimeSnapshot }
