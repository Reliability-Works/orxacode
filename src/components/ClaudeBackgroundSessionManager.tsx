import { useCallback, useEffect, useRef } from 'react'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import { persistedSessions } from './claude-terminal-session-store'

export function ClaudeBackgroundSessionManager({
  directory,
  sessionStorageKey,
}: {
  directory: string
  sessionStorageKey: string
}) {
  const busyResetTimerRef = useRef<number | null>(null)
  const initClaudeSession = useUnifiedRuntimeStore(state => state.initClaudeSession)
  const setClaudeBusy = useUnifiedRuntimeStore(state => state.setClaudeBusy)
  const setClaudeAwaiting = useUnifiedRuntimeStore(state => state.setClaudeAwaiting)
  const setClaudeActivityAt = useUnifiedRuntimeStore(state => state.setClaudeActivityAt)

  const clearBusyResetTimer = useCallback(() => {
    if (busyResetTimerRef.current !== null) {
      window.clearTimeout(busyResetTimerRef.current)
      busyResetTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    initClaudeSession(sessionStorageKey, directory)
    setClaudeAwaiting(sessionStorageKey, false)
  }, [directory, initClaudeSession, sessionStorageKey, setClaudeAwaiting])

  useEffect(() => {
    const sessions = [...persistedSessions.values()].filter(
      session => !session.exited && session.storageKey.startsWith(`${sessionStorageKey}::`)
    )
    if (sessions.length === 0) {
      return
    }

    const listener = (
      event: { type: 'output'; chunk: string } | { type: 'closed'; exitCode: number | null }
    ) => {
      if (event.type === 'output') {
        setClaudeActivityAt(sessionStorageKey, Date.now())
        setClaudeBusy(sessionStorageKey, true)
        clearBusyResetTimer()
        busyResetTimerRef.current = window.setTimeout(() => {
          busyResetTimerRef.current = null
          setClaudeBusy(sessionStorageKey, false)
        }, 2200)
        return
      }

      const anyOpenSessions = [...persistedSessions.values()].some(
        session => !session.exited && session.storageKey.startsWith(`${sessionStorageKey}::`)
      )
      if (!anyOpenSessions) {
        clearBusyResetTimer()
        setClaudeBusy(sessionStorageKey, false)
      }
    }

    sessions.forEach(session => {
      session.listeners.add(listener)
    })
    return () => {
      sessions.forEach(session => {
        session.listeners.delete(listener)
      })
    }
  }, [clearBusyResetTimer, sessionStorageKey, setClaudeActivityAt, setClaudeBusy])

  useEffect(
    () => () => {
      clearBusyResetTimer()
      setClaudeBusy(sessionStorageKey, false)
    },
    [clearBusyResetTimer, sessionStorageKey, setClaudeBusy]
  )

  return null
}
