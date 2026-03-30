import { useEffect, useState } from 'react'
import type { ClaudeChatModelEntry } from '@shared/ipc'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  getPersistedClaudeChatState,
  setPersistedClaudeChatState,
} from './claude-chat-session-storage'
import { useClaudeChatSessionLiveSync } from './useClaudeChatSessionLiveSync'
import { toClaudeModelOptions } from './claude-chat-session-utils'

function loadClaudeChatModelOptions(setModelOptions: (value: ClaudeChatModelEntry[]) => void) {
  let cancelled = false
  void window.orxa.claudeChat.listModels().then(models => {
    if (!cancelled) {
      setModelOptions(models)
    }
  })
  return () => {
    cancelled = true
  }
}

export function useClaudeChatSessionRuntime(directory: string, sessionKey: string) {
  const runtime = useUnifiedRuntimeStore(state => state.claudeChatSessions[sessionKey] ?? null)
  const initClaudeChatSession = useUnifiedRuntimeStore(state => state.initClaudeChatSession)
  const replaceClaudeChatMessages = useUnifiedRuntimeStore(state => state.replaceClaudeChatMessages)
  const setClaudeChatStreaming = useUnifiedRuntimeStore(state => state.setClaudeChatStreaming)
  const setClaudeChatHistoryMessages = useUnifiedRuntimeStore(
    state => state.setClaudeChatHistoryMessages
  )
  const setClaudeChatSubagents = useUnifiedRuntimeStore(state => state.setClaudeChatSubagents)
  const [modelOptions, setModelOptions] = useState<ClaudeChatModelEntry[]>([])

  useEffect(() => {
    initClaudeChatSession(sessionKey, directory)
    const persisted = getPersistedClaudeChatState(sessionKey)
    if (persisted.messages.length > 0) {
      replaceClaudeChatMessages(sessionKey, persisted.messages)
      setClaudeChatStreaming(sessionKey, persisted.isStreaming)
      setClaudeChatHistoryMessages(sessionKey, persisted.historyMessages)
      setClaudeChatSubagents(sessionKey, persisted.subagents)
    }
  }, [
    directory,
    initClaudeChatSession,
    replaceClaudeChatMessages,
    sessionKey,
    setClaudeChatHistoryMessages,
    setClaudeChatStreaming,
    setClaudeChatSubagents,
  ])

  useEffect(() => {
    if (!runtime) {
      return
    }
    setPersistedClaudeChatState(sessionKey, {
      messages: runtime.messages,
      historyMessages: runtime.historyMessages,
      isStreaming: runtime.isStreaming,
      messageIdCounter: getPersistedClaudeChatState(sessionKey).messageIdCounter,
      subagents: runtime.subagents,
    })
  }, [runtime, sessionKey])

  useEffect(() => loadClaudeChatModelOptions(setModelOptions), [])
  useClaudeChatSessionLiveSync(directory, sessionKey, runtime)

  return {
    runtime,
    modelOptions: toClaudeModelOptions(modelOptions),
  }
}
