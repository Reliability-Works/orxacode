import { useEffect } from 'react'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  subscribeClaudeChatSessionEvents,
  type ClaudeChatSessionEventContext,
} from './claude-chat-session-events'
import type {
  ClaudeChatApprovalRequest,
  ClaudeChatHistoryMessage,
  ClaudeChatState,
  ClaudeChatUserInputRequest,
} from '@shared/ipc'

function hasClaudeChatRecoverableActivity(
  runtime:
    | {
        providerThreadId?: string | null
        isStreaming?: boolean
        pendingApproval?: ClaudeChatApprovalRequest | null
        pendingUserInput?: ClaudeChatUserInputRequest | null
        subagents?: unknown[]
      }
    | null
) {
  return Boolean(
    runtime?.providerThreadId ||
      runtime?.isStreaming ||
      runtime?.pendingApproval ||
      runtime?.pendingUserInput ||
      (runtime?.subagents?.length ?? 0)
  )
}

function createClaudeChatStateSyncCallback(
  directory: string,
  sessionKey: string,
  setClaudeChatConnectionState: (
    sessionKey: string,
    status: ClaudeChatState['status'],
    providerThreadId?: string,
    activeTurnId?: string | null,
    lastError?: string
  ) => void,
  setClaudeChatHistoryMessages: (
    sessionKey: string,
    historyMessages: ClaudeChatHistoryMessage[]
  ) => void
) {
  return async () => {
    if (!window.orxa?.claudeChat) {
      return
    }
    const state = await window.orxa.claudeChat.getState(sessionKey)
    setClaudeChatConnectionState(
      sessionKey,
      state.status,
      state.providerThreadId,
      state.activeTurnId,
      state.lastError
    )
    if (state.providerThreadId) {
      const historyMessages = await window.orxa.claudeChat
        .getSessionMessages(state.providerThreadId, directory)
        .catch(() => [])
      setClaudeChatHistoryMessages(sessionKey, historyMessages)
    }
  }
}

export function useClaudeChatSessionLiveSync(
  directory: string,
  sessionKey: string,
  runtime:
    | {
        providerThreadId?: string | null
        isStreaming?: boolean
        pendingApproval?: ClaudeChatApprovalRequest | null
        pendingUserInput?: ClaudeChatUserInputRequest | null
        subagents?: unknown[]
      }
    | null
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
  const setClaudeChatHistoryMessages = useUnifiedRuntimeStore(
    state => state.setClaudeChatHistoryMessages
  )
  const setClaudeChatSubagents = useUnifiedRuntimeStore(state => state.setClaudeChatSubagents)
  const updateClaudeChatMessages = useUnifiedRuntimeStore(state => state.updateClaudeChatMessages)
  const syncClaudeChatState = createClaudeChatStateSyncCallback(
    directory,
    sessionKey,
    setClaudeChatConnectionState,
    setClaudeChatHistoryMessages
  )

  useEffect(() => {
    void syncClaudeChatState()
  }, [syncClaudeChatState])

  useEffect(() => {
    if (!hasClaudeChatRecoverableActivity(runtime)) {
      return
    }
    const timer = window.setInterval(() => {
      void syncClaudeChatState()
    }, 2_000)
    const onResume = () => {
      void syncClaudeChatState()
    }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('pageshow', onResume)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('pageshow', onResume)
    }
  }, [
    runtime,
    runtime?.isStreaming,
    runtime?.pendingApproval,
    runtime?.pendingUserInput,
    runtime?.providerThreadId,
    runtime?.subagents?.length,
    syncClaudeChatState,
  ])

  useEffect(() => {
    const context: ClaudeChatSessionEventContext = {
      directory,
      sessionKey,
      setClaudeChatConnectionState,
      setClaudeChatProviderThreadId,
      setClaudeChatPendingApproval,
      setClaudeChatPendingUserInput,
      setClaudeChatStreaming,
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
    setClaudeChatSubagents,
    updateClaudeChatMessages,
  ])
}
