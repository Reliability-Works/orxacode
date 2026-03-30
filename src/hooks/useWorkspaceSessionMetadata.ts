import { useCallback, useMemo } from 'react'
import { clearPersistedClaudeChatState } from './claude-chat-session-storage'
import { clearPersistedCodexState } from './codex-session-storage'
import { usePersistedState } from './usePersistedState'
import { readPersistedValue } from '../lib/persistence'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  buildWorkspaceSessionMetadataKey,
  readWorkspaceSessionMetadata,
} from '../lib/workspace-session-metadata'
import type { SessionType } from '../types/canvas'

export const LEGACY_SESSION_TYPES_KEY = 'orxa:sessionTypes:v1'
export const LEGACY_SESSION_TITLES_KEY = 'orxa:sessionTitles:v1'
export const SESSION_TYPES_KEY = 'orxa:sessionTypes:v2'
export const SESSION_TITLES_KEY = 'orxa:sessionTitles:v2'
export const MANUAL_SESSION_TITLES_KEY = 'orxa:manualSessionTitles:v1'

export function readLocalStorageRecord<T>(key: string): Record<string, T> {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const raw = readPersistedValue(key)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as Record<string, T>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function useWorkspaceSessionMetadata() {
  const removeCodexSession = useUnifiedRuntimeStore(state => state.removeCodexSession)
  const removeClaudeChatSession = useUnifiedRuntimeStore(state => state.removeClaudeChatSession)

  const [sessionTypes, setSessionTypes] = usePersistedState<Record<string, SessionType>>(SESSION_TYPES_KEY, {})
  const [sessionTitles, setSessionTitles] = usePersistedState<Record<string, string>>(SESSION_TITLES_KEY, {})
  const [manualSessionTitles, setManualSessionTitles] = usePersistedState<Record<string, boolean>>(MANUAL_SESSION_TITLES_KEY, {})

  const clearSessionMetadata = useCallback(
    (sessionKey: string) => {
      setSessionTypes(prev => {
        if (!(sessionKey in prev)) {
          return prev
        }
        const next = { ...prev }
        delete next[sessionKey]
        return next
      })
      setSessionTitles(prev => {
        if (!(sessionKey in prev)) {
          return prev
        }
        const next = { ...prev }
        delete next[sessionKey]
        return next
      })
      setManualSessionTitles(prev => {
        if (!(sessionKey in prev)) {
          return prev
        }
        const next = { ...prev }
        delete next[sessionKey]
        return next
      })
    },
    [setManualSessionTitles, setSessionTitles, setSessionTypes]
  )

  const getSessionType = useCallback(
    (sessionID: string, directory?: string) => {
      if (!sessionID) {
        return undefined
      }
      return readWorkspaceSessionMetadata(sessionTypes, directory, sessionID) ?? 'standalone'
    },
    [sessionTypes]
  )

  const getSessionTitle = useCallback(
    (sessionID: string, directory?: string, fallbackTitle?: string) =>
      readWorkspaceSessionMetadata(sessionTitles, directory, sessionID) ?? fallbackTitle,
    [sessionTitles]
  )

  const normalizePresentationProvider = useCallback((sessionType: string | undefined) => {
    if (sessionType === 'codex' || sessionType === 'claude' || sessionType === 'claude-chat') {
      return sessionType
    }
    if (sessionType === 'opencode' || sessionType === 'canvas' || sessionType === 'standalone') {
      return 'opencode' as const
    }
    return undefined
  }, [])

  const cleanupEmptySession = useCallback(
    (directory: string, sessionID: string) => {
      const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
      const sessionType = getSessionType(sessionID, directory)
      if (sessionType === 'codex') {
        clearPersistedCodexState(sessionKey)
        removeCodexSession(sessionKey)
      } else if (sessionType === 'claude-chat') {
        clearPersistedClaudeChatState(sessionKey)
        removeClaudeChatSession(sessionKey)
      }
      clearSessionMetadata(sessionKey)
    },
    [clearSessionMetadata, getSessionType, removeClaudeChatSession, removeCodexSession]
  )

  const codexSessionCount = useMemo(
    () => Object.values(sessionTypes).filter(type => type === 'codex').length,
    [sessionTypes]
  )
  const claudeSessionCount = useMemo(
    () =>
      Object.values(sessionTypes).filter(type => type === 'claude' || type === 'claude-chat')
        .length,
    [sessionTypes]
  )

  return {
    sessionTypes, setSessionTypes, sessionTitles, setSessionTitles, manualSessionTitles,
    setManualSessionTitles, codexSessionCount, claudeSessionCount, clearSessionMetadata,
    cleanupEmptySession, getSessionType, getSessionTitle, normalizePresentationProvider,
  }
}
