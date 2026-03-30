import type { StateCreator } from 'zustand'
import type {
  ClaudeChatApprovalRequest,
  ClaudeChatUserInputRequest,
  CodexApprovalRequest,
  CodexState,
  CodexThread,
  CodexUserInputRequest,
  ProjectBootstrap,
  SessionMessageBundle,
} from '@shared/ipc'
import type { TodoItem } from '../components/chat/TodoDock'
import type { CodexMessageItem } from '../hooks/codex-session-types'
import type { SubagentInfo } from '../hooks/useCodexSession'
import type {
  CodexThreadRuntimeSnapshot,
  OpencodeSessionRuntimeSnapshot,
  UnifiedClaudeChatSessionRuntime,
  UnifiedCodexSessionRuntime,
  UnifiedOpencodeSessionRuntime,
  UnifiedProvider,
} from './unified-runtime'
import type { ClaudeChatMessageItem, ClaudeChatSubagentState } from '../hooks/useClaudeChatSession'

export type CachedSessionEntry = {
  id: string
  title?: string
  slug: string
  time: { created: number; updated: number; archived?: number }
}

export type UnifiedClaudeSessionRuntime = {
  key: string
  directory: string
  busy: boolean
  awaiting: boolean
  activityAt: number
}

export type UnifiedWorkspaceMeta = {
  lastOpenedAt: number
  lastUpdatedAt: number
}

export type UnifiedRuntimeStoreState = {
  activeWorkspaceDirectory?: string
  activeSessionID?: string
  pendingSessionId?: string
  activeProvider?: UnifiedProvider
  projectDataByDirectory: Record<string, ProjectBootstrap>
  workspaceMetaByDirectory: Record<string, UnifiedWorkspaceMeta>
  opencodeSessions: Record<string, UnifiedOpencodeSessionRuntime>
  codexSessions: Record<string, UnifiedCodexSessionRuntime>
  claudeChatSessions: Record<string, UnifiedClaudeChatSessionRuntime>
  claudeSessions: Record<string, UnifiedClaudeSessionRuntime>
  sessionReadTimestamps: Record<string, number>
  sessionAbortRequestedAt: Record<string, number>
  collapsedProjects: Record<string, boolean>
  setActiveWorkspaceDirectory: (directory?: string) => void
  setActiveSession: (sessionID?: string, provider?: UnifiedProvider) => void
  setPendingSessionId: (sessionID?: string) => void
  setProjectData: (directory: string, project: ProjectBootstrap) => void
  removeProjectData: (directory: string) => void
  setWorkspaceMeta: (directory: string, meta: Partial<UnifiedWorkspaceMeta>) => void
  setOpencodeMessages: (
    directory: string,
    sessionID: string,
    messages: SessionMessageBundle[]
  ) => void
  setOpencodeRuntimeSnapshot: (
    directory: string,
    sessionID: string,
    snapshot: OpencodeSessionRuntimeSnapshot
  ) => void
  setOpencodeTodoItems: (directory: string, sessionID: string, items: TodoItem[]) => void
  removeOpencodeSession: (directory: string, sessionID: string) => void
  setCollapsedProject: (directory: string, collapsed: boolean) => void
  replaceCollapsedProjects: (next: Record<string, boolean>) => void
  setSessionReadAt: (sessionKey: string, timestamp: number) => void
  clearSessionReadAt: (sessionKey: string) => void
  markSessionAbortRequestedAt: (sessionKey: string, timestamp: number) => void
  initClaudeChatSession: (sessionKey: string, directory: string) => void
  setClaudeChatConnectionState: (
    sessionKey: string,
    status: UnifiedClaudeChatSessionRuntime['connectionStatus'],
    providerThreadId?: string | null,
    activeTurnId?: string | null,
    lastError?: string
  ) => void
  setClaudeChatProviderThreadId: (sessionKey: string, providerThreadId: string | null) => void
  replaceClaudeChatMessages: (sessionKey: string, messages: ClaudeChatMessageItem[]) => void
  updateClaudeChatMessages: (
    sessionKey: string,
    updater: (previous: ClaudeChatMessageItem[]) => ClaudeChatMessageItem[]
  ) => void
  setClaudeChatHistoryMessages: (
    sessionKey: string,
    messages: UnifiedClaudeChatSessionRuntime['historyMessages']
  ) => void
  setClaudeChatPendingApproval: (
    sessionKey: string,
    request: ClaudeChatApprovalRequest | null
  ) => void
  setClaudeChatPendingUserInput: (
    sessionKey: string,
    request: ClaudeChatUserInputRequest | null
  ) => void
  setClaudeChatStreaming: (sessionKey: string, isStreaming: boolean) => void
  setClaudeChatSubagents: (
    sessionKey: string,
    subagents:
      | ClaudeChatSubagentState[]
      | ((previous: ClaudeChatSubagentState[]) => ClaudeChatSubagentState[])
  ) => void
  removeClaudeChatSession: (sessionKey: string) => void
  initClaudeSession: (sessionKey: string, directory: string) => void
  setClaudeBusy: (sessionKey: string, busy: boolean) => void
  setClaudeAwaiting: (sessionKey: string, awaiting: boolean) => void
  setClaudeActivityAt: (sessionKey: string, activityAt: number) => void
  removeClaudeSession: (sessionKey: string) => void
  initCodexSession: (sessionKey: string, directory: string) => void
  setCodexConnectionState: (
    sessionKey: string,
    status: CodexState['status'],
    serverInfo?: CodexState['serverInfo'],
    lastError?: string
  ) => void
  setCodexThread: (sessionKey: string, thread: CodexThread | null) => void
  setCodexRuntimeSnapshot: (sessionKey: string, snapshot: CodexThreadRuntimeSnapshot | null) => void
  replaceCodexMessages: (sessionKey: string, messages: CodexMessageItem[]) => void
  updateCodexMessages: (
    sessionKey: string,
    updater: (previous: CodexMessageItem[]) => CodexMessageItem[]
  ) => void
  setCodexPendingApproval: (sessionKey: string, request: CodexApprovalRequest | null) => void
  setCodexPendingUserInput: (sessionKey: string, request: CodexUserInputRequest | null) => void
  setCodexStreaming: (sessionKey: string, isStreaming: boolean) => void
  setCodexThreadName: (sessionKey: string, name?: string) => void
  setCodexPlanItems: (sessionKey: string, items: TodoItem[]) => void
  setCodexDismissedPlanIds: (sessionKey: string, ids: string[]) => void
  setCodexSubagents: (sessionKey: string, subagents: SubagentInfo[]) => void
  setCodexActiveSubagentThreadId: (sessionKey: string, threadId: string | null) => void
  resetCodexSession: (sessionKey: string) => void
  removeCodexSession: (sessionKey: string) => void
}

export type UnifiedRuntimeStoreSet = Parameters<StateCreator<UnifiedRuntimeStoreState>>[0]
