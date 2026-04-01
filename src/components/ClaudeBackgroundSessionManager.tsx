import { useCallback, useEffect, useRef } from 'react'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import { persistedSessions } from './claude-terminal-session-store'
import { reportPerf } from '../lib/performance'

export function ClaudeBackgroundSessionManager({
  directory,
  sessionStorageKey,
}: {
  directory: string
  sessionStorageKey: string
}) {
  const mountedAtRef = useRef<number | null>(null)
  const reportedRef = useRef(false)
  const busyResetTimerRef = useRef<number | null>(null)
  const claudeSession = useUnifiedRuntimeStore(
    state => state.claudeSessions[sessionStorageKey] ?? null
  )
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
    mountedAtRef.current = performance.now()
    reportedRef.current = false
    initClaudeSession(sessionStorageKey, directory)
    setClaudeAwaiting(sessionStorageKey, false)
  }, [directory, initClaudeSession, sessionStorageKey, setClaudeAwaiting])

  useEffect(() => {
    if (reportedRef.current || mountedAtRef.current === null) {
      return
    }

    const isHydrated = () => {
      const matchingSessions = [...persistedSessions.values()].filter(
        session => !session.exited && session.storageKey.startsWith(`${sessionStorageKey}::`)
      )
      const runtimeReady = matchingSessions.some(
        session => session.startupReady || session.outputChunks.length > 0
      )
      return (
        runtimeReady ||
        (claudeSession?.activityAt ?? 0) > 0 ||
        claudeSession?.busy === true ||
        claudeSession?.awaiting === true
      )
    }

    const markHydrated = () => {
      if (!isHydrated() || reportedRef.current || mountedAtRef.current === null) {
        return false
      }
      reportedRef.current = true
      reportPerf({
        surface: 'background',
        metric: 'background.resume_sync_ms',
        kind: 'span',
        value: performance.now() - mountedAtRef.current,
        unit: 'ms',
        process: 'renderer',
        trigger: 'resume',
        component: 'claude-background-session-manager',
        workspaceHash: directory,
        sessionHash: sessionStorageKey,
      })
      return true
    }

    if (markHydrated()) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (markHydrated()) {
        window.clearInterval(intervalId)
      }
    }, 200)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [
    claudeSession?.activityAt,
    claudeSession?.awaiting,
    claudeSession?.busy,
    directory,
    sessionStorageKey,
  ])

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
