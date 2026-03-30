import { useCallback, useEffect, useRef, useState } from 'react'
import { readPersistedValue, removePersistedValue, writePersistedValue } from '../lib/persistence'
import {
  EMPTY_WORKSPACE_SESSIONS_KEY,
  type ContextMenuState,
  PINNED_SESSIONS_KEY,
  readPersistedEmptySessions,
  type SidebarMode,
} from './useWorkspaceState-shared'

export function useWorkspaceStateLocal() {
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('projects')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [pinnedSessions, setPinnedSessions] = useState<Record<string, string[]>>(() => {
    try {
      const raw = readPersistedValue(PINNED_SESSIONS_KEY)
      if (!raw) {
        return {}
      }
      const parsed = JSON.parse(raw) as Record<string, string[]>
      if (!parsed || typeof parsed !== 'object') {
        return {}
      }
      return parsed
    } catch {
      return {}
    }
  })
  const emptySessionIds = useRef<Map<string, string>>(new Map())
  const persistedEmptySessionIds = useRef<Map<string, string>>(readPersistedEmptySessions())

  const persistEmptySessionIds = useCallback(() => {
    try {
      const next = Object.fromEntries(persistedEmptySessionIds.current.entries())
      if (Object.keys(next).length === 0) {
        removePersistedValue(EMPTY_WORKSPACE_SESSIONS_KEY)
        return
      }
      writePersistedValue(EMPTY_WORKSPACE_SESSIONS_KEY, JSON.stringify(next))
    } catch {
      // Ignore storage failures.
    }
  }, [])

  const rememberEmptySession = useCallback(
    (sessionID: string, directory: string) => {
      emptySessionIds.current.set(sessionID, directory)
      persistedEmptySessionIds.current.set(sessionID, directory)
      persistEmptySessionIds()
    },
    [persistEmptySessionIds]
  )

  const forgetEmptySession = useCallback(
    (sessionID: string) => {
      emptySessionIds.current.delete(sessionID)
      if (persistedEmptySessionIds.current.delete(sessionID)) {
        persistEmptySessionIds()
      }
    },
    [persistEmptySessionIds]
  )

  useEffect(() => {
    writePersistedValue(PINNED_SESSIONS_KEY, JSON.stringify(pinnedSessions))
  }, [pinnedSessions])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const close = () => setContextMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }

    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  return {
    sidebarMode,
    setSidebarMode,
    contextMenu,
    setContextMenu,
    pinnedSessions,
    setPinnedSessions,
    emptySessionIds,
    persistedEmptySessionIds,
    rememberEmptySession,
    forgetEmptySession,
  }
}
