import { useCallback, useEffect, useRef } from 'react'
import type { ProjectBootstrap } from '@shared/ipc'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import type { SessionType } from '../types/canvas'
import { usePersistedState } from './usePersistedState'
import {
  LOCAL_PROVIDER_SESSIONS_KEY,
  createLocalProviderSessionRecord,
  markLocalProviderSessionRecordStarted,
  mergeLocalProviderSessions,
  normalizeSyntheticSessionMap,
  removeLocalProviderSessionRecord,
  renameLocalProviderSessionRecord,
  touchLocalProviderSessionRecord,
  upsertLocalProviderSessionRecord,
} from '../lib/local-provider-sessions'
import { buildWorkspaceSessionMetadataKey } from '../lib/workspace-session-metadata'

type SyntheticSessionRecord = ReturnType<typeof createLocalProviderSessionRecord>

type UseSyntheticSessionRegistryArgs = {
  clearSyntheticSessionMetadata: (directory: string, sessionID: string) => void
  getStoredSessionType: (sessionID: string, directory?: string) => SessionType | undefined
  setProjectDataForDirectory: (directory: string, data: ProjectBootstrap) => void
  setSessionTitles: Dispatch<SetStateAction<Record<string, string>>>
  setSessionTypes: Dispatch<SetStateAction<Record<string, SessionType>>>
  setWorkspaceMeta: (directory: string, meta: { lastUpdatedAt?: number; lastOpenedAt?: number }) => void
}

function useSyntheticSessionLookup(
  syntheticSessionsRef: MutableRefObject<Record<string, SyntheticSessionRecord>>,
  getStoredSessionType: UseSyntheticSessionRegistryArgs['getStoredSessionType']
) {
  const getSyntheticSessionRecord = useCallback(
    (directory: string | undefined, sessionID: string | undefined) => {
      if (!directory || !sessionID) {
        return undefined
      }
      return syntheticSessionsRef.current[buildWorkspaceSessionMetadataKey(directory, sessionID)]
    },
    [syntheticSessionsRef]
  )

  const getSessionType = useCallback(
    (sessionID: string, directory?: string) => {
      const storedType = getStoredSessionType(sessionID, directory)
      if (storedType && storedType !== 'opencode') {
        return storedType
      }
      return getSyntheticSessionRecord(directory, sessionID)?.type ?? storedType
    },
    [getStoredSessionType, getSyntheticSessionRecord]
  )
  const isSyntheticSession = useCallback(
    (directory: string | undefined, sessionID: string | undefined) =>
      Boolean(getSyntheticSessionRecord(directory, sessionID)),
    [getSyntheticSessionRecord]
  )

  return { getSyntheticSessionRecord, getSessionType, isSyntheticSession }
}

function useSyntheticSessionMetadataSync(
  syntheticSessions: Record<string, SyntheticSessionRecord>,
  setSessionTitles: UseSyntheticSessionRegistryArgs['setSessionTitles'],
  setSessionTypes: UseSyntheticSessionRegistryArgs['setSessionTypes']
) {
  useEffect(() => {
    const records = Object.values(syntheticSessions)
    if (records.length === 0) {
      return
    }

    setSessionTypes(current => {
      let changed = false
      const next = { ...current }
      for (const record of records) {
        const sessionKey = buildWorkspaceSessionMetadataKey(record.directory, record.sessionID)
        if (next[sessionKey] === record.type) {
          continue
        }
        next[sessionKey] = record.type
        changed = true
      }
      return changed ? next : current
    })

    setSessionTitles(current => {
      let changed = false
      const next = { ...current }
      for (const record of records) {
        const sessionKey = buildWorkspaceSessionMetadataKey(record.directory, record.sessionID)
        if (next[sessionKey] === record.title) {
          continue
        }
        next[sessionKey] = record.title
        changed = true
      }
      return changed ? next : current
    })
  }, [setSessionTitles, setSessionTypes, syntheticSessions])
}

function useSyntheticSessionProjectSync({
  setProjectDataForDirectory,
  setWorkspaceMeta,
}: Pick<
  UseSyntheticSessionRegistryArgs,
  'setProjectDataForDirectory' | 'setWorkspaceMeta'
>) {
  const syncSyntheticSessionsIntoProject = useCallback(
    (directory: string, nextRecords: Record<string, SyntheticSessionRecord>) => {
      const state = useUnifiedRuntimeStore.getState()
      const cached = state.projectDataByDirectory[directory]
      if (!cached) {
        return
      }
      const merged = mergeLocalProviderSessions(cached, nextRecords)
      setProjectDataForDirectory(directory, merged)
      const lastUpdated = merged.sessions.reduce(
        (max, session) => Math.max(max, session.time.updated),
        0
      )
      setWorkspaceMeta(directory, { lastUpdatedAt: lastUpdated })
    },
    [setProjectDataForDirectory, setWorkspaceMeta]
  )

  return { syncSyntheticSessionsIntoProject }
}

function useSyntheticSessionMutations({
  clearSyntheticSessionMetadata,
  setSyntheticSessions,
  syntheticSessionsRef,
  syncSyntheticSessionsIntoProject,
}: {
  clearSyntheticSessionMetadata: UseSyntheticSessionRegistryArgs['clearSyntheticSessionMetadata']
  setSyntheticSessions: (value: Record<string, SyntheticSessionRecord>) => void
  syntheticSessionsRef: MutableRefObject<Record<string, SyntheticSessionRecord>>
  syncSyntheticSessionsIntoProject: (
    directory: string,
    nextRecords: Record<string, SyntheticSessionRecord>
  ) => void
}) {
  const registerSyntheticSession = useCallback(
    (record: SyntheticSessionRecord) => {
      const next = upsertLocalProviderSessionRecord(syntheticSessionsRef.current, record)
      syntheticSessionsRef.current = next
      setSyntheticSessions(next)
      syncSyntheticSessionsIntoProject(record.directory, next)
      return record
    },
    [setSyntheticSessions, syncSyntheticSessionsIntoProject, syntheticSessionsRef]
  )

  const removeSyntheticSession = useCallback(
    (directory: string, sessionID: string) => {
      const current = syntheticSessionsRef.current
      const next = removeLocalProviderSessionRecord(current, directory, sessionID)
      if (next === current) {
        return
      }
      syntheticSessionsRef.current = next
      setSyntheticSessions(next)
      syncSyntheticSessionsIntoProject(directory, next)
      clearSyntheticSessionMetadata(directory, sessionID)
    },
    [clearSyntheticSessionMetadata, setSyntheticSessions, syncSyntheticSessionsIntoProject, syntheticSessionsRef]
  )

  const renameSyntheticSession = useCallback(
    (directory: string, sessionID: string, title: string) => {
      const next = renameLocalProviderSessionRecord(syntheticSessionsRef.current, directory, sessionID, title)
      syntheticSessionsRef.current = next
      setSyntheticSessions(next)
      syncSyntheticSessionsIntoProject(directory, next)
    },
    [setSyntheticSessions, syncSyntheticSessionsIntoProject, syntheticSessionsRef]
  )

  const touchSyntheticSession = useCallback(
    (directory: string, sessionID: string, updatedAt?: number) => {
      const next = touchLocalProviderSessionRecord(
        syntheticSessionsRef.current,
        directory,
        sessionID,
        updatedAt
      )
      if (next === syntheticSessionsRef.current) {
        return
      }
      syntheticSessionsRef.current = next
      setSyntheticSessions(next)
      syncSyntheticSessionsIntoProject(directory, next)
    },
    [setSyntheticSessions, syncSyntheticSessionsIntoProject, syntheticSessionsRef]
  )

  const markSyntheticSessionStarted = useCallback(
    (directory: string, sessionID: string, updatedAt?: number) => {
      const next = markLocalProviderSessionRecordStarted(
        syntheticSessionsRef.current,
        directory,
        sessionID,
        updatedAt
      )
      if (next === syntheticSessionsRef.current) {
        return
      }
      syntheticSessionsRef.current = next
      setSyntheticSessions(next)
      syncSyntheticSessionsIntoProject(directory, next)
    },
    [setSyntheticSessions, syncSyntheticSessionsIntoProject, syntheticSessionsRef]
  )

  return {
    registerSyntheticSession,
    removeSyntheticSession,
    renameSyntheticSession,
    touchSyntheticSession,
    markSyntheticSessionStarted,
  }
}

export function useSyntheticSessionRegistry({
  clearSyntheticSessionMetadata,
  getStoredSessionType,
  setProjectDataForDirectory,
  setSessionTitles,
  setSessionTypes,
  setWorkspaceMeta,
}: UseSyntheticSessionRegistryArgs) {
  const [syntheticSessions, setSyntheticSessions] = usePersistedState<
    Record<string, SyntheticSessionRecord>
  >(LOCAL_PROVIDER_SESSIONS_KEY, {}, {
    deserialize: raw => normalizeSyntheticSessionMap(JSON.parse(raw)),
  })
  const syntheticSessionsRef = useRef(syntheticSessions)
  useEffect(() => {
    syntheticSessionsRef.current = syntheticSessions
  }, [syntheticSessions])
  const { getSyntheticSessionRecord, getSessionType, isSyntheticSession } =
    useSyntheticSessionLookup(syntheticSessionsRef, getStoredSessionType)
  useSyntheticSessionMetadataSync(syntheticSessions, setSessionTitles, setSessionTypes)
  const { syncSyntheticSessionsIntoProject } = useSyntheticSessionProjectSync({
    setProjectDataForDirectory,
    setWorkspaceMeta,
  })
  const {
    registerSyntheticSession,
    removeSyntheticSession,
    renameSyntheticSession,
    touchSyntheticSession,
    markSyntheticSessionStarted,
  } = useSyntheticSessionMutations({
    clearSyntheticSessionMetadata,
    setSyntheticSessions,
    syntheticSessionsRef,
    syncSyntheticSessionsIntoProject,
  })

  return {
    getSyntheticSessionRecord,
    getSessionType,
    isSyntheticSession,
    registerSyntheticSession,
    removeSyntheticSession,
    renameSyntheticSession,
    touchSyntheticSession,
    markSyntheticSessionStarted,
    mergeProjectDataWithSyntheticSessions: useCallback(
      (project: ProjectBootstrap) => mergeLocalProviderSessions(project, syntheticSessionsRef.current),
      [syntheticSessionsRef]
    ),
  }
}
