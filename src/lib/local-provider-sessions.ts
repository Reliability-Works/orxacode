import type { Session } from '@opencode-ai/sdk/v2/client'
import type { ProjectBootstrap } from '@shared/ipc'
import type { SessionType } from '../types/canvas'
import { normalizeSessionType } from './session-types'
import { buildWorkspaceSessionMetadataKey } from './workspace-session-metadata'

export const LOCAL_PROVIDER_SESSIONS_KEY = 'orxa:localProviderSessions:v1'

export type SyntheticSessionType = Extract<
  SessionType,
  'opencode' | 'codex' | 'claude' | 'claude-chat'
>
export type LocalProviderSessionType = Exclude<SyntheticSessionType, 'opencode'>

export type LocalProviderSessionRecord = {
  sessionID: string
  directory: string
  type: SyntheticSessionType
  title: string
  slug: string
  createdAt: number
  updatedAt: number
  draft: boolean
}

export type LocalProviderSessionMap = Record<string, LocalProviderSessionRecord>

const LOCAL_PROVIDER_TYPES = new Set<LocalProviderSessionType>(['codex', 'claude', 'claude-chat'])
const SYNTHETIC_SESSION_TYPES = new Set<SyntheticSessionType>([
  'opencode',
  'codex',
  'claude',
  'claude-chat',
])

export function isLocalProviderSessionType(
  type: string | undefined
): type is LocalProviderSessionType {
  return Boolean(type && LOCAL_PROVIDER_TYPES.has(type as LocalProviderSessionType))
}

export function isSyntheticSessionType(type: string | undefined): type is SyntheticSessionType {
  const normalized = normalizeSessionType(type)
  return Boolean(normalized && SYNTHETIC_SESSION_TYPES.has(normalized as SyntheticSessionType))
}

export function createLocalProviderSessionRecord(
  directory: string,
  type: SyntheticSessionType,
  title: string,
  options?: { draft?: boolean }
): LocalProviderSessionRecord {
  const now = Date.now()
  const token =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  const sessionID = `${type}-${now.toString(36)}-${token}`
  return {
    sessionID,
    directory,
    type,
    title,
    slug: type,
    createdAt: now,
    updatedAt: now,
    draft: options?.draft ?? false,
  }
}

export function createBoundLocalProviderSessionRecord(
  directory: string,
  type: SyntheticSessionType,
  sessionID: string,
  title: string,
  options?: { draft?: boolean }
): LocalProviderSessionRecord {
  const now = Date.now()
  return {
    sessionID,
    directory,
    type,
    title,
    slug: type,
    createdAt: now,
    updatedAt: now,
    draft: options?.draft ?? false,
  }
}

export function normalizeSyntheticSessionRecord(
  record: Partial<LocalProviderSessionRecord> | null | undefined
): LocalProviderSessionRecord | null {
  const type = normalizeSessionType(record?.type)
  if (
    !record ||
    !type ||
    !isSyntheticSessionType(type) ||
    typeof record.sessionID !== 'string' ||
    typeof record.directory !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.slug !== 'string' ||
    typeof record.createdAt !== 'number' ||
    typeof record.updatedAt !== 'number'
  ) {
    return null
  }
  return {
    sessionID: record.sessionID,
    directory: record.directory,
    type,
    title: record.title,
    slug: record.slug === 'standalone' ? 'opencode' : record.slug,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    draft: record.draft === true,
  }
}

export function normalizeSyntheticSessionMap(
  raw: unknown
): LocalProviderSessionMap {
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  const normalizedEntries = Object.entries(raw).flatMap(([key, value]) => {
    const record = normalizeSyntheticSessionRecord(value as Partial<LocalProviderSessionRecord>)
    return record ? [[key, record] as const] : []
  })
  return Object.fromEntries(normalizedEntries)
}

export function toLocalProviderSession(record: LocalProviderSessionRecord): Session {
  return {
    id: record.sessionID,
    projectID: record.directory,
    directory: record.directory,
    slug: record.slug,
    title: record.title,
    version: 'local',
    time: {
      created: record.createdAt,
      updated: record.updatedAt,
    },
  } as unknown as Session
}

export function mergeLocalProviderSessions(
  project: ProjectBootstrap,
  records: LocalProviderSessionMap
): ProjectBootstrap {
  const localRecordKeys = new Set(
    Object.values(records)
      .filter(record => record.directory === project.directory)
      .map(record => buildWorkspaceSessionMetadataKey(record.directory, record.sessionID))
  )
  const retainedSessions = project.sessions.filter(
    session => !localRecordKeys.has(buildWorkspaceSessionMetadataKey(project.directory, session.id))
  )
  const retainedStatus = Object.fromEntries(
    Object.entries(project.sessionStatus).filter(
      ([sessionID]) =>
        !localRecordKeys.has(buildWorkspaceSessionMetadataKey(project.directory, sessionID))
    )
  )

  const localRecords = Object.values(records)
    .filter(record => record.directory === project.directory)
    .map(record => ({ ...record }))

  const mergedSessions = [
    ...retainedSessions,
    ...localRecords.map(record => toLocalProviderSession(record)),
  ].sort((left, right) => right.time.updated - left.time.updated)

  for (const record of localRecords) {
    if (!(record.sessionID in retainedStatus)) {
      retainedStatus[record.sessionID] = { type: 'idle' }
    }
  }

  return {
    ...project,
    sessions: mergedSessions,
    sessionStatus: retainedStatus,
  }
}

export function findLocalProviderDraftSession(
  map: LocalProviderSessionMap,
  directory: string,
  type: SyntheticSessionType
): LocalProviderSessionRecord | undefined {
  return Object.values(map)
    .filter(record => record.directory === directory && record.type === type && record.draft)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

export function upsertLocalProviderSessionRecord(
  map: LocalProviderSessionMap,
  record: LocalProviderSessionRecord
): LocalProviderSessionMap {
  const sessionKey = buildWorkspaceSessionMetadataKey(record.directory, record.sessionID)
  return {
    ...map,
    [sessionKey]: record,
  }
}

export function removeLocalProviderSessionRecord(
  map: LocalProviderSessionMap,
  directory: string,
  sessionID: string
): LocalProviderSessionMap {
  const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
  if (!(sessionKey in map)) {
    return map
  }
  const next = { ...map }
  delete next[sessionKey]
  return next
}

export function renameLocalProviderSessionRecord(
  map: LocalProviderSessionMap,
  directory: string,
  sessionID: string,
  title: string
): LocalProviderSessionMap {
  const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
  const current = map[sessionKey]
  if (!current) {
    return map
  }
  if (current.title === title) {
    return map
  }
  return {
    ...map,
    [sessionKey]: {
      ...current,
      title,
      updatedAt: Date.now(),
    },
  }
}

export function touchLocalProviderSessionRecord(
  map: LocalProviderSessionMap,
  directory: string,
  sessionID: string,
  updatedAt = Date.now()
): LocalProviderSessionMap {
  const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
  const current = map[sessionKey]
  if (!current || updatedAt <= current.updatedAt) {
    return map
  }
  return {
    ...map,
    [sessionKey]: {
      ...current,
      updatedAt,
    },
  }
}

export function pruneLocalProviderDraftSessions(
  map: LocalProviderSessionMap,
  directory: string,
  type: SyntheticSessionType,
  keepSessionID: string
): LocalProviderSessionMap {
  let changed = false
  const nextEntries = Object.entries(map).filter(([, record]) => {
    const shouldKeep =
      record.directory !== directory ||
      record.type !== type ||
      !record.draft ||
      record.sessionID === keepSessionID
    if (!shouldKeep) {
      changed = true
    }
    return shouldKeep
  })
  return changed ? Object.fromEntries(nextEntries) : map
}

export function markLocalProviderSessionRecordStarted(
  map: LocalProviderSessionMap,
  directory: string,
  sessionID: string,
  updatedAt = Date.now()
): LocalProviderSessionMap {
  const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
  const current = map[sessionKey]
  if (!current) {
    return map
  }
  const prunedMap = pruneLocalProviderDraftSessions(map, directory, current.type, sessionID)
  const prunedCurrent = prunedMap[sessionKey]
  if (!prunedCurrent) {
    return prunedMap
  }
  const nextUpdatedAt =
    updatedAt > prunedCurrent.updatedAt ? updatedAt : prunedCurrent.updatedAt
  if (!prunedCurrent.draft && nextUpdatedAt === prunedCurrent.updatedAt) {
    return prunedMap
  }
  return {
    ...prunedMap,
    [sessionKey]: {
      ...prunedCurrent,
      draft: false,
      updatedAt: nextUpdatedAt,
    },
  }
}
