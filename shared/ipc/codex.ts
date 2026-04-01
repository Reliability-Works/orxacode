export type CodexDoctorResult = {
  version: string
  appServer: 'ok' | 'error' | 'unknown'
  node: 'ok' | 'error' | 'unknown'
  path: string
  raw: string
}

export type CodexUpdateResult = {
  ok: boolean
  message: string
}

export type CodexModelEntry = {
  id: string
  model: string
  name: string
  isDefault: boolean
  supportedReasoningEfforts: string[]
  defaultReasoningEffort: string | null
}

export type CodexCollaborationMode = {
  id: string
  label: string
  mode: string
  model: string
  reasoningEffort: string
  developerInstructions: string
}

export type CodexConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type CodexState = {
  status: CodexConnectionStatus
  serverInfo?: { name: string; version: string }
  lastError?: string
}

export type CodexThread = {
  id: string
  preview: string
  modelProvider: string
  createdAt: number
  status?: { type: string }
  ephemeral?: boolean
}

export type CodexRunMetadata = {
  title: string
  worktreeName: string
}

export type CodexThreadRuntime = {
  thread: CodexThread | null
  childThreads: CodexThread[]
}

export type CodexBrowserImportedSession = {
  sessionKey: string
  sessionID: string
  directory: string
}

export type CodexBrowserThreadSummary = {
  threadId: string
  title: string
  lastUpdatedAt: number
  cwd?: string
  preview?: string
  isArchived: boolean
  importedSession?: CodexBrowserImportedSession
}

export type CodexResumeProviderThreadResult = {
  threadId: string
  sessionKey: string
  sessionID: string
  directory: string
  title: string
}

export type CodexWorkspaceThreadEntry = CodexThread & {
  directory: string
  sessionKey: string
}

export type CodexNotification = {
  method: string
  params: Record<string, unknown>
}

export type CodexAttachment = {
  type: 'image'
  url: string
}

export type CodexApprovalRequest = {
  id: number
  method: string
  itemId: string
  threadId: string
  turnId: string
  reason: string
  command?: string[]
  commandActions?: string[]
  availableDecisions: string[]
  changes?: Array<{
    path: string
    type: string
    insertions?: number
    deletions?: number
  }>
}

export type CodexUserInputQuestion = {
  id: string
  header: string
  question: string
  isOther?: boolean
  options?: { id: string; label: string; value: string }[]
}

export type CodexUserInputRequest = {
  id: number
  method: string
  threadId: string
  turnId: string
  itemId: string
  message: string
  questions?: CodexUserInputQuestion[]
}
