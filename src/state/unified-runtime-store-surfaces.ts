import type { SessionStatus } from '@opencode-ai/sdk/v2/client'
import { useUnifiedRuntimeStore } from './unified-runtime-store'
import type { UnifiedProvider } from './unified-runtime'
import {
  buildClaudeChatBackgroundAgents,
  buildComposerPresentation,
  buildCodexBackgroundAgents,
  buildCodexBackgroundAgentsFromChildThreads,
  buildCodexBackgroundAgentsFromMessages,
  buildOpencodeBackgroundAgents,
  buildPermissionDockData,
  buildQuestionDockData,
  buildTaskListPresentation,
  extractCodexTodoItemsFromMessages,
  extractOpencodeTodoItems,
  filterOutCurrentCodexThreadAgent,
  projectCodexSessionPresentation,
  type UnifiedBackgroundAgentSummary,
  type UnifiedComposerState,
  type UnifiedPendingActionSurface,
  type UnifiedPermissionDockData,
  type UnifiedProjectedSessionPresentation,
  type UnifiedQuestionDockData,
  type UnifiedTaskListPresentation,
} from '../lib/session-presentation'
import { projectClaudeChatProjectedSessionPresentation } from '../lib/claude-chat-session-presentation'
import { projectOpencodeSessionPresentation } from '../lib/opencode-session-presentation'
import { buildOpencodeKey } from './unified-runtime-store-helpers'
import {
  buildClaudeChatSessionStatus,
  buildClaudeSessionStatus,
  buildCodexSessionStatus,
  buildOpencodeSessionStatus,
} from './unified-runtime-store-status'

function describeApprovalRequest(request: { reason: string; method: string }) {
  const trimmedReason = request.reason.trim()
  if (trimmedReason) {
    return trimmedReason
  }
  if (request.method.includes('commandExecution')) {
    return 'Approval required to run a command.'
  }
  if (request.method.includes('fileChange')) {
    return 'Approval required to edit files.'
  }
  if (request.method.includes('fileRead')) {
    return 'Approval required to read files.'
  }
  return 'Approval required.'
}

function formatPendingApprovalFiles(changes?: Array<{ path: string; type: string }>) {
  if (!changes || changes.length === 0) {
    return undefined
  }
  const normalized = changes
    .map(change => {
      const path = change.path.trim()
      if (!path) {
        return null
      }
      const prefix =
        change.type === 'add' ? 'A' : change.type === 'delete' ? 'D' : change.type ? 'M' : ''
      return prefix ? `${prefix} ${path}` : path
    })
    .filter((entry): entry is string => Boolean(entry))
  if (normalized.length === 0) {
    return undefined
  }
  return normalized.length <= 4
    ? normalized.join(', ')
    : `${normalized.slice(0, 4).join(', ')} +${normalized.length - 4} more`
}

function getCodexPendingActionSurface(sessionKey: string): UnifiedPendingActionSurface | null {
  const session = useUnifiedRuntimeStore.getState().codexSessions[sessionKey]
  if (session?.pendingApproval) {
    return {
      kind: 'permission',
      provider: 'codex',
      awaiting: true,
      label: 'Agent needs permission to continue',
    }
  }
  if (session?.pendingUserInput) {
    return {
      kind: 'question',
      provider: 'codex',
      awaiting: true,
      label: 'Agent is asking a question',
    }
  }
  if (session && session.planItems.length > 0 && !session.isStreaming) {
    return { kind: 'plan', provider: 'codex', awaiting: true, label: 'Plan is ready for review' }
  }
  return null
}

function getClaudeChatPendingActionSurface(sessionKey: string): UnifiedPendingActionSurface | null {
  const session = useUnifiedRuntimeStore.getState().claudeChatSessions[sessionKey]
  if (session?.pendingApproval) {
    return {
      kind: 'permission',
      provider: 'claude-chat',
      awaiting: true,
      label: 'Claude needs permission to continue',
    }
  }
  if (session?.pendingUserInput) {
    return {
      kind: 'question',
      provider: 'claude-chat',
      awaiting: true,
      label: 'Claude is asking a question',
    }
  }
  return null
}

function getOpencodePendingActionSurface(
  directory: string,
  sessionID: string
): UnifiedPendingActionSurface | null {
  const runtime =
    useUnifiedRuntimeStore.getState().opencodeSessions[buildOpencodeKey(directory, sessionID)]
      ?.runtimeSnapshot
  const permission = runtime?.permissions.find(request => request.sessionID === sessionID)
  if (permission) {
    return {
      kind: 'permission',
      provider: 'opencode',
      awaiting: true,
      label: permission.permission ?? 'Agent needs permission to continue',
    }
  }
  const question = runtime?.questions.find(request => request.sessionID === sessionID)
  if (question) {
    return {
      kind: 'question',
      provider: 'opencode',
      awaiting: true,
      label: 'Agent is asking a question',
    }
  }
  return null
}

export function selectActivePendingActionSurface(input: {
  provider: UnifiedProvider | 'claude' | undefined
  directory?: string
  sessionID?: string
  sessionKey?: string
}): UnifiedPendingActionSurface | null {
  const { directory, provider, sessionID, sessionKey } = input
  if (provider === 'codex' && sessionKey) {
    return getCodexPendingActionSurface(sessionKey)
  }
  if (provider === 'claude-chat' && sessionKey) {
    return getClaudeChatPendingActionSurface(sessionKey)
  }
  if (provider === 'opencode' && directory && sessionID) {
    return getOpencodePendingActionSurface(directory, sessionID)
  }
  return null
}

export function selectActiveTaskListPresentation(input: {
  provider: UnifiedProvider | 'claude' | undefined
  directory?: string
  sessionID?: string
  sessionKey?: string
}): UnifiedTaskListPresentation | null {
  const { directory, provider, sessionID, sessionKey } = input
  const state = useUnifiedRuntimeStore.getState()
  if (provider === 'codex' && sessionKey) {
    const session = state.codexSessions[sessionKey]
    const items = session?.planItems?.length
      ? session.planItems
      : extractCodexTodoItemsFromMessages(session?.messages ?? [])
    return buildTaskListPresentation('codex', items)
  }
  if (provider === 'opencode' && directory && sessionID) {
    const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)]
    const items = runtime?.todoItems?.length
      ? runtime.todoItems
      : extractOpencodeTodoItems(runtime?.messages ?? [])
    return buildTaskListPresentation('opencode', items)
  }
  return null
}

function buildCodexBackgroundAgentSummary(sessionKey: string): UnifiedBackgroundAgentSummary[] {
  const session = useUnifiedRuntimeStore.getState().codexSessions[sessionKey]
  const currentThreadId = session?.thread?.id ?? session?.runtimeSnapshot?.thread?.id ?? null
  const runtimeAgents = buildCodexBackgroundAgents(session?.subagents ?? [])
  if (runtimeAgents.length > 0) {
    return filterOutCurrentCodexThreadAgent(runtimeAgents, currentThreadId)
  }
  const childThreadAgents = buildCodexBackgroundAgentsFromChildThreads(
    session?.runtimeSnapshot?.childThreads ?? []
  )
  if (childThreadAgents.length > 0) {
    return filterOutCurrentCodexThreadAgent(childThreadAgents, currentThreadId)
  }
  return filterOutCurrentCodexThreadAgent(
    buildCodexBackgroundAgentsFromMessages(session?.messages ?? []),
    currentThreadId
  )
}

export function selectActiveBackgroundAgentsPresentation(input: {
  provider: UnifiedProvider | 'claude' | undefined
  directory?: string
  sessionID?: string
  sessionKey?: string
}): UnifiedBackgroundAgentSummary[] {
  const { directory, provider, sessionID, sessionKey } = input
  const state = useUnifiedRuntimeStore.getState()
  if (provider === 'codex' && sessionKey) {
    return buildCodexBackgroundAgentSummary(sessionKey)
  }
  if (provider === 'claude-chat' && sessionKey) {
    return buildClaudeChatBackgroundAgents(state.claudeChatSessions[sessionKey]?.subagents ?? [])
  }
  if (provider === 'opencode' && directory && sessionID) {
    const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)]
    const sessionStatus = state.projectDataByDirectory[directory]?.sessionStatus
    return buildOpencodeBackgroundAgents(runtime?.messages ?? [], sessionStatus)
  }
  return []
}

function getCodexSessionPresentation(
  sessionKey: string
): UnifiedProjectedSessionPresentation | null {
  const session = useUnifiedRuntimeStore.getState().codexSessions[sessionKey]
  if (!session) {
    return null
  }
  const presentation = projectCodexSessionPresentation(session.messages, session.isStreaming)
  return {
    ...presentation,
    latestActivity: null,
    placeholderTimestamp: session.messages.at(-1)?.timestamp ?? 0,
  }
}

function getClaudeChatSessionPresentation(
  sessionKey: string
): UnifiedProjectedSessionPresentation | null {
  const session = useUnifiedRuntimeStore.getState().claudeChatSessions[sessionKey]
  if (!session) {
    return null
  }
  return projectClaudeChatProjectedSessionPresentation(
    session.messages,
    session.isStreaming,
    session.subagents
  )
}

function getOpencodeSessionPresentation(
  directory: string,
  sessionID: string,
  sessionKey: string | undefined,
  assistantLabel: string | undefined
): UnifiedProjectedSessionPresentation {
  const state = useUnifiedRuntimeStore.getState()
  const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)]
  const unifiedStatus = buildOpencodeSessionStatus(
    directory,
    sessionID,
    state.activeWorkspaceDirectory === directory && state.activeSessionID === sessionID,
    sessionKey ?? `${directory}::${sessionID}`
  )
  const effectiveSessionStatus =
    runtime?.runtimeSnapshot?.sessionStatus ??
    (unifiedStatus.busy ? ({ type: 'busy' } as SessionStatus) : undefined)
  return projectOpencodeSessionPresentation({
    messages: runtime?.messages ?? [],
    sessionDiff: runtime?.runtimeSnapshot?.sessionDiff ?? [],
    sessionStatus: effectiveSessionStatus,
    executionLedger: runtime?.runtimeSnapshot?.executionLedger.records ?? [],
    changeProvenance: runtime?.runtimeSnapshot?.changeProvenance.records ?? [],
    assistantLabel,
    workspaceDirectory: directory,
  })
}

export function selectSessionPresentation(input: {
  provider: UnifiedProvider | 'claude' | undefined
  directory?: string
  sessionID?: string
  sessionKey?: string
  assistantLabel?: string
}): UnifiedProjectedSessionPresentation | null {
  const { assistantLabel, directory, provider, sessionID, sessionKey } = input
  if (provider === 'codex' && sessionKey) {
    return getCodexSessionPresentation(sessionKey)
  }
  if (provider === 'claude-chat' && sessionKey) {
    return getClaudeChatSessionPresentation(sessionKey)
  }
  if (provider === 'opencode' && directory && sessionID) {
    return getOpencodeSessionPresentation(directory, sessionID, sessionKey, assistantLabel)
  }
  return null
}

function buildCodexPermissionDockData(sessionKey: string, permissionMode?: string) {
  const request = useUnifiedRuntimeStore.getState().codexSessions[sessionKey]?.pendingApproval
  if (!request || permissionMode === 'yolo-write') {
    return null
  }
  const filePattern = formatPendingApprovalFiles(request.changes)
  return buildPermissionDockData({
    provider: 'codex',
    requestId: request.id,
    description:
      filePattern === undefined && request.method.includes('fileChange')
        ? `${describeApprovalRequest(request)} Codex did not include the target file list yet.`
        : describeApprovalRequest(request),
    filePattern,
    command: request.command,
  })
}

function buildClaudeChatPermissionDockData(sessionKey: string, permissionMode?: string) {
  const request = useUnifiedRuntimeStore.getState().claudeChatSessions[sessionKey]?.pendingApproval
  if (!request || permissionMode === 'yolo-write') {
    return null
  }
  return buildPermissionDockData({
    provider: 'claude-chat',
    requestId: request.id,
    description: request.reason,
    command: request.command ? [request.command] : undefined,
  })
}

function buildOpencodePermissionDockData(directory: string, sessionID: string) {
  const state = useUnifiedRuntimeStore.getState()
  const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)]?.runtimeSnapshot
  const projectData = state.projectDataByDirectory[directory]
  const request =
    runtime?.permissions.find(candidate => candidate.sessionID === sessionID) ??
    projectData?.permissions.find(candidate => candidate.sessionID === sessionID)
  if (!request) {
    return null
  }
  return buildPermissionDockData({
    provider: 'opencode',
    requestId: request.id,
    description: request.permission ?? 'Permission requested',
    filePattern: request.patterns?.[0],
  })
}

export function selectPendingPermissionDockData(input: {
  provider: UnifiedProvider | 'claude' | undefined
  directory?: string
  sessionID?: string
  sessionKey?: string
  permissionMode?: string
}): UnifiedPermissionDockData | null {
  const { directory, permissionMode, provider, sessionID, sessionKey } = input
  if (provider === 'codex' && sessionKey) {
    return buildCodexPermissionDockData(sessionKey, permissionMode)
  }
  if (provider === 'claude-chat' && sessionKey) {
    return buildClaudeChatPermissionDockData(sessionKey, permissionMode)
  }
  if (provider === 'opencode' && directory && sessionID) {
    return buildOpencodePermissionDockData(directory, sessionID)
  }
  return null
}

function buildCodexQuestionDockData(sessionKey: string) {
  const request = useUnifiedRuntimeStore.getState().codexSessions[sessionKey]?.pendingUserInput
  if (!request) {
    return null
  }
  const questions = request.questions?.length
    ? request.questions.map(question => ({
        id: question.id || request.itemId || 'user-input-q',
        header: question.header || undefined,
        text: question.question || request.message || 'The agent is requesting your input.',
        options: question.options?.map(option => ({
          id: option.id,
          label: option.label,
          value: option.value,
        })),
      }))
    : [
        {
          id: request.itemId || 'user-input-q',
          text: request.message || 'The agent is requesting your input.',
        },
      ]
  return buildQuestionDockData({
    provider: 'codex',
    requestId: request.id,
    questions,
  })
}

function buildClaudeChatQuestionDockData(sessionKey: string) {
  const request = useUnifiedRuntimeStore.getState().claudeChatSessions[sessionKey]?.pendingUserInput
  if (!request) {
    return null
  }
  return buildQuestionDockData({
    provider: 'claude-chat',
    requestId: request.id,
    questions: [
      {
        id: request.elicitationId ?? request.id,
        header: request.server,
        text: request.message,
        options: request.options,
      },
    ],
  })
}

function buildOpencodeQuestionDockData(directory: string, sessionID: string) {
  const state = useUnifiedRuntimeStore.getState()
  const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)]?.runtimeSnapshot
  const projectData = state.projectDataByDirectory[directory]
  const request =
    runtime?.questions.find(candidate => candidate.sessionID === sessionID) ??
    projectData?.questions.find(candidate => candidate.sessionID === sessionID)
  if (!request) {
    return null
  }
  return buildQuestionDockData({
    provider: 'opencode',
    requestId: request.id,
    questions: (request.questions ?? []).map((question, index) => ({
      id: `${request.id}-q${index}`,
      header: question.header,
      text: question.question,
      options: question.options?.map(option => ({ label: option.label, value: option.label })),
      multiSelect: question.multiple,
    })),
  })
}

export function selectPendingQuestionDockData(input: {
  provider: UnifiedProvider | 'claude' | undefined
  directory?: string
  sessionID?: string
  sessionKey?: string
}): UnifiedQuestionDockData | null {
  const { directory, provider, sessionID, sessionKey } = input
  if (provider === 'codex' && sessionKey) {
    return buildCodexQuestionDockData(sessionKey)
  }
  if (provider === 'claude-chat' && sessionKey) {
    return buildClaudeChatQuestionDockData(sessionKey)
  }
  if (provider === 'opencode' && directory && sessionID) {
    return buildOpencodeQuestionDockData(directory, sessionID)
  }
  return null
}

export function selectActiveComposerPresentation(input: {
  provider: UnifiedProvider | 'claude' | undefined
  directory?: string
  sessionID?: string
  sessionKey?: string
  sending: boolean
}): UnifiedComposerState {
  const { directory, provider, sending, sessionID, sessionKey } = input
  const status =
    provider === 'codex' && sessionKey
      ? buildCodexSessionStatus(sessionKey, true)
      : provider === 'claude-chat' && sessionKey
        ? buildClaudeChatSessionStatus(sessionKey, true)
        : provider === 'claude' && sessionKey
          ? buildClaudeSessionStatus(sessionKey, true)
          : provider === 'opencode' && directory && sessionID
            ? buildOpencodeSessionStatus(
                directory,
                sessionID,
                true,
                sessionKey ?? `${directory}::${sessionID}`
              )
            : null
  const pending = selectActivePendingActionSurface({ provider, directory, sessionID, sessionKey })
  return buildComposerPresentation({
    status,
    sending,
    pending,
  })
}
