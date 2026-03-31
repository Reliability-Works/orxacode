export type ClaudeChatEffort = 'low' | 'medium' | 'high' | 'max' | 'ultrathink'

export type ClaudeChatModelEntry = {
  id: string
  name: string
  isDefault: boolean
  supportsFastMode: boolean
  supportsThinkingToggle: boolean
  supportedReasoningEfforts: ClaudeChatEffort[]
  defaultReasoningEffort: Exclude<ClaudeChatEffort, 'ultrathink'> | null
}

export type ClaudeChatConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type ClaudeChatState = {
  sessionKey: string
  status: ClaudeChatConnectionStatus
  providerThreadId?: string
  lastError?: string
  activeTurnId?: string | null
}

export type ClaudeBrowserImportedSession = {
  sessionKey: string
  sessionID: string
  directory: string
}

export type ClaudeBrowserSessionSummary = {
  providerThreadId: string
  title: string
  lastUpdatedAt: number
  cwd?: string
  preview?: string
  isArchived: boolean
  importedSession?: ClaudeBrowserImportedSession
}

export type ClaudeResumeProviderSessionResult = {
  providerThreadId: string
  sessionKey: string
  sessionID: string
  directory: string
  title: string
}

export type ClaudeChatApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

export type ClaudeChatApprovalRequest = {
  id: string
  sessionKey: string
  threadId: string
  turnId: string
  itemId: string
  toolName: string
  reason: string
  command?: string
  availableDecisions: ClaudeChatApprovalDecision[]
}

export type ClaudeChatQuestionOption = {
  label: string
  value: string
}

export type ClaudeChatUserInputRequest = {
  id: string
  sessionKey: string
  threadId: string
  turnId: string
  message: string
  options?: ClaudeChatQuestionOption[]
  mode?: 'form' | 'url'
  server?: string
  elicitationId?: string
}

export type ClaudeChatNotification = {
  sessionKey: string
  method: string
  params: Record<string, unknown>
}

export type ClaudeChatHistoryMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  sessionId: string
}

export type ClaudeChatAttachment = {
  path: string
  url: string
  filename: string
  mime: string
}

export type ClaudeChatTurnOptions = {
  model?: string
  cwd?: string
  permissionMode?: string
  effort?: ClaudeChatEffort
  fastMode?: boolean
  thinking?: boolean
  maxThinkingTokens?: number
  attachments?: ClaudeChatAttachment[]
}

export type ClaudeChatHealthStatus = {
  available: boolean
  authenticated: boolean | null
  version?: string
  message?: string
}
