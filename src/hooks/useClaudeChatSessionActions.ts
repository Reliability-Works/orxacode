import { useCallback } from 'react'
import type { ClaudeChatAttachment, ClaudeChatHistoryMessage } from '@shared/ipc'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  clearPersistedClaudeChatState,
} from './claude-chat-session-storage'
import { nextClaudeMessageId } from './claude-chat-session-utils'

export type ClaudeChatSessionActions = {
  startTurn: (
    prompt: string,
    options?: {
      model?: string
      permissionMode?: string
      effort?: 'low' | 'medium' | 'high' | 'max' | 'ultrathink'
      fastMode?: boolean
      thinking?: boolean
      attachments?: ClaudeChatAttachment[]
      displayPrompt?: string
    }
  ) => Promise<void>
  interruptTurn: () => Promise<void>
  approveAction: (
    requestId: string,
    decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel'
  ) => Promise<void>
  respondToUserInput: (requestId: string, response: string) => Promise<void>
  archiveSession: () => Promise<void>
  archiveProviderSession: (providerThreadId: string) => Promise<void>
  loadSubagentMessages: (providerThreadId: string) => Promise<ClaudeChatHistoryMessage[]>
}

export function useClaudeChatSessionActions(directory: string, sessionKey: string) {
  const updateClaudeChatMessages = useUnifiedRuntimeStore(state => state.updateClaudeChatMessages)
  const setClaudeChatPendingApproval = useUnifiedRuntimeStore(
    state => state.setClaudeChatPendingApproval
  )
  const setClaudeChatPendingUserInput = useUnifiedRuntimeStore(
    state => state.setClaudeChatPendingUserInput
  )
  const removeClaudeChatSession = useUnifiedRuntimeStore(state => state.removeClaudeChatSession)

  const startTurn = useCallback<ClaudeChatSessionActions['startTurn']>(
    async (prompt, options) => {
      const timestamp = Date.now()
      const userId = nextClaudeMessageId(sessionKey)
      const displayPrompt = options?.displayPrompt ?? prompt
      const turnOptions = { ...(options ?? {}) }
      delete (turnOptions as { displayPrompt?: string }).displayPrompt
      updateClaudeChatMessages(sessionKey, messages => [
        ...messages,
        {
          id: userId,
          kind: 'message',
          role: 'user',
          content: displayPrompt,
          timestamp,
        },
      ])
      await window.orxa.claudeChat.startTurn(sessionKey, directory, prompt, {
        cwd: directory,
        ...turnOptions,
      })
    },
    [directory, sessionKey, updateClaudeChatMessages]
  )

  const interruptTurn = useCallback(async () => {
    await window.orxa.claudeChat.interruptTurn(sessionKey)
  }, [sessionKey])

  const approveAction = useCallback(
    async (requestId: string, decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel') => {
      await window.orxa.claudeChat.approve(requestId, decision)
      setClaudeChatPendingApproval(sessionKey, null)
    },
    [sessionKey, setClaudeChatPendingApproval]
  )

  const respondToUserInput = useCallback(
    async (requestId: string, response: string) => {
      await window.orxa.claudeChat.respondToUserInput(requestId, response)
      setClaudeChatPendingUserInput(sessionKey, null)
    },
    [sessionKey, setClaudeChatPendingUserInput]
  )

  const archiveSession = useCallback(async () => {
    await window.orxa.claudeChat.archiveSession(sessionKey)
    clearPersistedClaudeChatState(sessionKey)
    removeClaudeChatSession(sessionKey)
  }, [removeClaudeChatSession, sessionKey])

  const archiveProviderSession = useCallback(
    async (providerThreadId: string) => {
      await window.orxa.claudeChat.archiveProviderSession(providerThreadId, directory)
    },
    [directory]
  )

  const loadSubagentMessages = useCallback(
    async (providerThreadId: string): Promise<ClaudeChatHistoryMessage[]> => {
      const messages = await window.orxa.claudeChat.getSessionMessages(providerThreadId, directory)
      return messages
    },
    [directory]
  )

  return {
    startTurn,
    interruptTurn,
    approveAction,
    respondToUserInput,
    archiveSession,
    archiveProviderSession,
    loadSubagentMessages,
  }
}
