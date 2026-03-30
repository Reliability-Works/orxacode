import { useClaudeChatSessionActions } from './useClaudeChatSessionActions'
import { useClaudeChatSessionRuntime } from './useClaudeChatSessionRuntime'
export type {
  ClaudeChatMessageItem,
  ClaudeChatSubagentState,
} from './claude-chat-session-utils'

export function useClaudeChatSession(directory: string, sessionKey: string) {
  const { runtime, modelOptions } = useClaudeChatSessionRuntime(directory, sessionKey)
  const {
    startTurn,
    interruptTurn,
    approveAction,
    respondToUserInput,
    archiveSession,
    archiveProviderSession,
    loadSubagentMessages,
  } = useClaudeChatSessionActions(directory, sessionKey)

  return {
    connectionStatus: runtime?.connectionStatus ?? 'disconnected',
    providerThreadId: runtime?.providerThreadId ?? null,
    messages: runtime?.messages ?? [],
    pendingApproval: runtime?.pendingApproval ?? null,
    pendingUserInput: runtime?.pendingUserInput ?? null,
    isStreaming: runtime?.isStreaming ?? false,
    lastError: runtime?.lastError,
    subagents: runtime?.subagents ?? [],
    modelOptions,
    startTurn,
    interruptTurn,
    approveAction,
    respondToUserInput,
    archiveSession,
    archiveProviderSession,
    loadSubagentMessages,
  }
}
