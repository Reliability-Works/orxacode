import { useCallback, useEffect, useRef } from 'react'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  subscribeClaudeChatSessionEvents,
  type ClaudeChatSessionEventContext,
} from './claude-chat-session-events'
import type {
  ClaudeChatApprovalRequest,
  ClaudeChatHistoryMessage,
  ClaudeChatUserInputRequest,
} from '@shared/ipc'

function hasClaudeChatRecoverableActivity(
  runtime: {
    providerThreadId?: string | null
    isStreaming?: boolean
    pendingApproval?: ClaudeChatApprovalRequest | null
    pendingUserInput?: ClaudeChatUserInputRequest | null
    subagents?: unknown[]
  } | null
) {
  return Boolean(
    runtime?.providerThreadId ||
    runtime?.isStreaming ||
    runtime?.pendingApproval ||
    runtime?.pendingUserInput ||
    (runtime?.subagents?.length ?? 0)
  )
}

const CLAUDE_CHAT_SYNC_MIN_INTERVAL_MS = 1_200

export function useClaudeChatSessionLiveSync(
  directory: string,
  sessionKey: string,
  runtime: {
    providerThreadId?: string | null
    isStreaming?: boolean
    pendingApproval?: ClaudeChatApprovalRequest | null
    pendingUserInput?: ClaudeChatUserInputRequest | null
    subagents?: unknown[]
  } | null
) {
  const setClaudeChatConnectionState = useUnifiedRuntimeStore(
    state => state.setClaudeChatConnectionState
  )
  const setClaudeChatProviderThreadId = useUnifiedRuntimeStore(
    state => state.setClaudeChatProviderThreadId
  )
  const setClaudeChatPendingApproval = useUnifiedRuntimeStore(
    state => state.setClaudeChatPendingApproval
  )
  const setClaudeChatPendingUserInput = useUnifiedRuntimeStore(
    state => state.setClaudeChatPendingUserInput
  )
  const setClaudeChatStreaming = useUnifiedRuntimeStore(state => state.setClaudeChatStreaming)
  const setClaudeChatTurnUsage = useUnifiedRuntimeStore(state => state.setClaudeChatTurnUsage)
  const setClaudeChatHistoryMessages = useUnifiedRuntimeStore(
    state => state.setClaudeChatHistoryMessages
  )
  const setClaudeChatSubagents = useUnifiedRuntimeStore(state => state.setClaudeChatSubagents)
  const updateClaudeChatMessages = useUnifiedRuntimeStore(state => state.updateClaudeChatMessages)
  const syncInFlightRef = useRef<Promise<void> | null>(null)
  const lastSyncAtRef = useRef(0)
  const lastHistoryThreadIdRef = useRef<string | null>(null)

  const syncClaudeChatState = useCallback(
    async (options?: { force?: boolean }) => {
      if (!window.orxa?.claudeChat) {
        return
      }
      if (syncInFlightRef.current) {
        return syncInFlightRef.current
      }
      const force = options?.force === true
      const now = Date.now()
      if (!force && now - lastSyncAtRef.current < CLAUDE_CHAT_SYNC_MIN_INTERVAL_MS) {
        return
      }

      const syncPromise = (async () => {
        const state = await window.orxa.claudeChat.getState(sessionKey)
        setClaudeChatConnectionState(
          sessionKey,
          state.status,
          state.providerThreadId,
          state.activeTurnId,
          state.lastError
        )
        if (!state.providerThreadId) {
          lastHistoryThreadIdRef.current = null
          lastSyncAtRef.current = Date.now()
          return
        }
        const shouldLoadHistory = force || lastHistoryThreadIdRef.current !== state.providerThreadId
        if (shouldLoadHistory) {
          const historyMessages = await window.orxa.claudeChat
            .getSessionMessages(state.providerThreadId, directory)
            .catch(() => [] as ClaudeChatHistoryMessage[])
          setClaudeChatHistoryMessages(sessionKey, historyMessages)
          lastHistoryThreadIdRef.current = state.providerThreadId
        }
        lastSyncAtRef.current = Date.now()
      })().finally(() => {
        syncInFlightRef.current = null
      })

      syncInFlightRef.current = syncPromise
      return syncPromise
    },
    [directory, sessionKey, setClaudeChatConnectionState, setClaudeChatHistoryMessages]
  )

  const hasRecoverableActivity = hasClaudeChatRecoverableActivity(runtime)

  useEffect(() => {
    void syncClaudeChatState({ force: true }).catch(() => undefined)
  }, [syncClaudeChatState])

  useEffect(() => {
    if (!hasRecoverableActivity) {
      return
    }
    const onResume = () => {
      if (document.visibilityState === 'hidden') {
        return
      }
      void syncClaudeChatState({ force: true }).catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('pageshow', onResume)
    return () => {
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('pageshow', onResume)
    }
  }, [hasRecoverableActivity, syncClaudeChatState])

  useEffect(() => {
    const context: ClaudeChatSessionEventContext = {
      directory,
      sessionKey,
      setClaudeChatConnectionState,
      setClaudeChatProviderThreadId,
      setClaudeChatPendingApproval,
      setClaudeChatPendingUserInput,
      setClaudeChatStreaming,
      setClaudeChatTurnUsage,
      setClaudeChatSubagents,
      updateClaudeChatMessages,
    }
    return subscribeClaudeChatSessionEvents(context)
  }, [
    directory,
    sessionKey,
    setClaudeChatConnectionState,
    setClaudeChatPendingApproval,
    setClaudeChatPendingUserInput,
    setClaudeChatProviderThreadId,
    setClaudeChatStreaming,
    setClaudeChatTurnUsage,
    setClaudeChatSubagents,
    updateClaudeChatMessages,
  ])
}
