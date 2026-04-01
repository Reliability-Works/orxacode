import { useEffect, useRef } from 'react'
import { useCodexSession } from '../hooks/useCodexSession'
import { reportPerf } from '../lib/performance'

type Props = {
  directory: string
  sessionStorageKey: string
  codexPath?: string
  codexArgs?: string
}

export function CodexBackgroundSessionManager({
  directory,
  sessionStorageKey,
  codexPath,
  codexArgs,
}: Props) {
  const mountedAtRef = useRef<number | null>(null)
  const reportedRef = useRef(false)
  const session = useCodexSession(directory, sessionStorageKey, { codexPath, codexArgs })

  useEffect(() => {
    mountedAtRef.current = performance.now()
    reportedRef.current = false
  }, [directory, sessionStorageKey])

  useEffect(() => {
    if (reportedRef.current || mountedAtRef.current === null) {
      return
    }
    const hydrated =
      session.connectionStatus === 'connected' ||
      Boolean(session.thread) ||
      session.messages.length > 0 ||
      Boolean(session.pendingApproval) ||
      Boolean(session.pendingUserInput) ||
      session.subagents.length > 0
    if (!hydrated) {
      return
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
      component: 'codex-background-session-manager',
      workspaceHash: directory,
      sessionHash: sessionStorageKey,
    })
  }, [
    directory,
    session.connectionStatus,
    session.messages.length,
    session.pendingApproval,
    session.pendingUserInput,
    sessionStorageKey,
    session.subagents.length,
    session.thread,
  ])

  return null
}
