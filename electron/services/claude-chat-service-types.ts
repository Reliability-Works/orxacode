import type { ElicitationRequest, PermissionResult, Query } from '@anthropic-ai/claude-agent-sdk'
import type {
  ClaudeChatHealthStatus,
  ClaudeChatState,
} from '@shared/ipc'

export type PendingApproval = {
  sessionKey: string
  turnId: string
  itemId: string
  toolName: string
  providerThreadId: string
  resolve: (result: PermissionResult) => void
}

export type PendingUserInput = {
  sessionKey: string
  turnId: string
  request: ElicitationRequest
  resolve: (result: {
    action: 'accept' | 'decline' | 'cancel'
    content?: Record<string, unknown>
  }) => void
}

export type ClaudeSubagentRuntime = {
  id: string
  description: string
  prompt?: string
  taskType?: string
  childSessionId?: string
  status: 'thinking' | 'awaiting_instruction' | 'completed' | 'idle'
  statusText: string
  summary?: string
}

export type ClaudeSessionRuntime = {
  state: ClaudeChatState
  directory: string
  activeQuery: Query | null
  runningTasks: ClaudeSubagentRuntime[]
  approvalThreadId?: string
  mainProviderThreadId?: string
  toolNamesById: Map<string, string>
  toolInputsById: Map<string, Record<string, unknown>>
}

export type CachedClaudeHealth = {
  value: ClaudeChatHealthStatus
  cachedAt: number
}
