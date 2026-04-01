import { useEffect, useRef } from 'react'
import { useClaudeChatSession } from '../hooks/useClaudeChatSession'
import { reportPerf } from '../lib/performance'

type Props = {
  directory: string
  sessionStorageKey: string
}

export function ClaudeChatBackgroundSessionManager({ directory, sessionStorageKey }: Props) {
  const mountedAtRef = useRef<number | null>(null)
  const reportedRef = useRef(false)
  const session = useClaudeChatSession(directory, sessionStorageKey)

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
      Boolean(session.providerThreadId) ||
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
      component: 'claude-chat-background-session-manager',
      workspaceHash: directory,
      sessionHash: sessionStorageKey,
    })
  }, [
    directory,
    session.connectionStatus,
    session.messages.length,
    session.pendingApproval,
    session.pendingUserInput,
    session.providerThreadId,
    sessionStorageKey,
    session.subagents.length,
  ])

  return null
}
