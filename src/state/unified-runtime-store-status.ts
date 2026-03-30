import { useUnifiedRuntimeStore } from './unified-runtime-store'
import { deriveUnifiedSessionStatus, type UnifiedProvider, type UnifiedSessionStatus } from './unified-runtime'
import type { SessionStatus } from '@opencode-ai/sdk/v2/client'
import {
  buildSidebarSessionPresentation,
  type UnifiedSidebarSessionState,
} from '../lib/session-presentation'
import { buildOpencodeKey } from './unified-runtime-store-helpers'

function getOpencodeSnapshotData(directory: string, sessionID: string) {
  const state = useUnifiedRuntimeStore.getState()
  const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)]
  const runtimeSnapshot = runtime?.runtimeSnapshot
  const projectData = state.projectDataByDirectory[directory]
  return { state, runtime, runtimeSnapshot, projectData }
}

function findLatestMessageTimestamp(
  messages: NonNullable<ReturnType<typeof getOpencodeSnapshotData>['runtimeSnapshot']>['messages'],
  role: 'assistant' | 'user'
) {
  return [...messages].reverse().find(bundle => bundle.info.role === role)?.info.time.created ?? 0
}

function hasRunningOpencodeTool(
  messages: NonNullable<ReturnType<typeof getOpencodeSnapshotData>['runtimeSnapshot']>['messages']
) {
  return messages.some(
    bundle =>
      bundle.info.role === 'assistant' &&
      bundle.parts.some(part => {
        if (part.type !== 'tool') {
          return false
        }
        const toolState = part.state as { status?: string } | undefined
        return toolState?.status === 'running' || toolState?.status === 'pending'
      })
  )
}

function hasOpencodePendingRequests(
  sessionID: string,
  snapshotData: ReturnType<typeof getOpencodeSnapshotData>
) {
  const { projectData, runtimeSnapshot } = snapshotData
  return Boolean(
    runtimeSnapshot?.permissions.some(request => request.sessionID === sessionID) ||
      runtimeSnapshot?.questions.some(request => request.sessionID === sessionID) ||
      projectData?.permissions.some(request => request.sessionID === sessionID) ||
      projectData?.questions.some(request => request.sessionID === sessionID)
  )
}

function isRecentlyBusyWithoutStatus(
  isActive: boolean,
  sessionStatus: SessionStatus | undefined,
  latestAssistantMessageAt: number,
  latestUserMessageAt: number
) {
  return (
    isActive &&
    !sessionStatus &&
    latestAssistantMessageAt >= latestUserMessageAt &&
    latestAssistantMessageAt > 0 &&
    Date.now() - latestAssistantMessageAt < 45_000
  )
}

function isBusySessionStatus(
  sessionStatus: SessionStatus | undefined
) {
  return sessionStatus?.type === 'busy' || sessionStatus?.type === 'retry'
}

function buildBusyState(
  sessionStatus: SessionStatus | undefined,
  hasRunningPart: boolean,
  inferredActiveTurnBusy: boolean,
  abortRequestedAt: number
) {
  const recentlyAborted = abortRequestedAt > 0 && Date.now() - abortRequestedAt < 15_000
  if (recentlyAborted) {
    return Boolean(isBusySessionStatus(sessionStatus))
  }
  return Boolean(
    isBusySessionStatus(sessionStatus) || hasRunningPart || inferredActiveTurnBusy
  )
}

function getStoredOpencodeSessionStatus(
  snapshotData: ReturnType<typeof getOpencodeSnapshotData>,
  sessionID: string
) {
  return (
    snapshotData.runtimeSnapshot?.sessionStatus ??
    snapshotData.projectData?.sessionStatus[sessionID]
  )
}

function getLatestOpencodeSessionUpdate(
  snapshotData: ReturnType<typeof getOpencodeSnapshotData>,
  sessionID: string
) {
  return (
    snapshotData.runtimeSnapshot?.session?.time.updated ??
    snapshotData.projectData?.sessions.find(session => session.id === sessionID)?.time.updated ??
    0
  )
}

function getLatestOpencodeMessageAt(snapshotData: ReturnType<typeof getOpencodeSnapshotData>) {
  return (
    snapshotData.runtimeSnapshot?.messages.at(-1)?.info.time.created ??
    snapshotData.runtime?.messages.at(-1)?.info.time.created ??
    0
  )
}

export function selectOpencodeSessionRuntime(
  directory: string | undefined,
  sessionID: string | undefined
) {
  if (!directory || !sessionID) {
    return null
  }
  const key = buildOpencodeKey(directory, sessionID)
  return useUnifiedRuntimeStore.getState().opencodeSessions[key] ?? null
}

export function selectCodexSessionRuntime(sessionKey: string | undefined) {
  if (!sessionKey) {
    return null
  }
  return useUnifiedRuntimeStore.getState().codexSessions[sessionKey] ?? null
}

export function selectClaudeChatSessionRuntime(sessionKey: string | undefined) {
  if (!sessionKey) {
    return null
  }
  return useUnifiedRuntimeStore.getState().claudeChatSessions[sessionKey] ?? null
}

export function buildCodexSessionStatus(
  sessionKey: string,
  isActive: boolean
): UnifiedSessionStatus {
  const state = useUnifiedRuntimeStore.getState()
  const session = state.codexSessions[sessionKey]
  const activityAt = session?.messages.at(-1)?.timestamp ?? 0
  return deriveUnifiedSessionStatus({
    busy: Boolean(session?.isStreaming),
    awaiting: Boolean(session?.pendingApproval || session?.pendingUserInput),
    planReady: Boolean(session && session.planItems.length > 0 && !session.isStreaming),
    activityAt,
    lastReadAt: state.sessionReadTimestamps[sessionKey],
    isActive,
  })
}

export function buildClaudeSessionStatus(
  sessionKey: string,
  isActive: boolean
): UnifiedSessionStatus {
  const state = useUnifiedRuntimeStore.getState()
  const session = state.claudeSessions[sessionKey]
  return deriveUnifiedSessionStatus({
    busy: Boolean(session?.busy),
    awaiting: Boolean(session?.awaiting),
    planReady: false,
    activityAt: session?.activityAt ?? 0,
    lastReadAt: state.sessionReadTimestamps[sessionKey],
    isActive,
  })
}

export function buildClaudeChatSessionStatus(
  sessionKey: string,
  isActive: boolean
): UnifiedSessionStatus {
  const state = useUnifiedRuntimeStore.getState()
  const session = state.claudeChatSessions[sessionKey]
  const activityAt = session?.messages.at(-1)?.timestamp ?? 0
  const hasActiveSubagents = Boolean(
    session?.subagents.some(
      agent => agent.status === 'thinking' || agent.status === 'awaiting_instruction'
    )
  )
  return deriveUnifiedSessionStatus({
    busy: Boolean(
      session?.isStreaming || session?.connectionStatus === 'connecting' || hasActiveSubagents
    ),
    awaiting: Boolean(session?.pendingApproval || session?.pendingUserInput),
    planReady: false,
    activityAt,
    lastReadAt: state.sessionReadTimestamps[sessionKey],
    isActive,
  })
}

export function buildOpencodeSessionStatus(
  directory: string,
  sessionID: string,
  isActive: boolean,
  sessionKey = `${directory}::${sessionID}`
): UnifiedSessionStatus {
  const snapshotData = getOpencodeSnapshotData(directory, sessionID)
  const { runtimeSnapshot, state } = snapshotData
  const sessionStatus = getStoredOpencodeSessionStatus(snapshotData, sessionID)
  const latestSessionUpdate = getLatestOpencodeSessionUpdate(snapshotData, sessionID)
  const latestAssistantMessageAt = findLatestMessageTimestamp(
    runtimeSnapshot?.messages ?? [],
    'assistant'
  )
  const latestUserMessageAt = findLatestMessageTimestamp(runtimeSnapshot?.messages ?? [], 'user')
  const latestMessageAt = getLatestOpencodeMessageAt(snapshotData)

  return deriveUnifiedSessionStatus({
    busy: buildBusyState(
      sessionStatus,
      hasRunningOpencodeTool(runtimeSnapshot?.messages ?? []),
      isRecentlyBusyWithoutStatus(
        isActive,
        sessionStatus,
        latestAssistantMessageAt,
        latestUserMessageAt
      ),
      state.sessionAbortRequestedAt[sessionKey] ?? 0
    ),
    awaiting: hasOpencodePendingRequests(sessionID, snapshotData),
    planReady: false,
    activityAt: Math.max(latestMessageAt, latestSessionUpdate),
    lastReadAt: state.sessionReadTimestamps[sessionKey],
    isActive,
  })
}

export function selectSidebarSessionPresentation(input: {
  provider: UnifiedProvider | 'claude'
  directory: string
  sessionID: string
  updatedAt: number
  isActive: boolean
  sessionKey: string
}): UnifiedSidebarSessionState {
  const { directory, isActive, provider, sessionID, sessionKey, updatedAt } = input
  const status =
    provider === 'codex'
      ? buildCodexSessionStatus(sessionKey, isActive)
      : provider === 'claude-chat'
        ? buildClaudeChatSessionStatus(sessionKey, isActive)
        : provider === 'claude'
          ? buildClaudeSessionStatus(sessionKey, isActive)
          : buildOpencodeSessionStatus(directory, sessionID, isActive, sessionKey)
  const presentation = buildSidebarSessionPresentation({
    sessionKey,
    status,
    updatedAt,
    isActive,
  })
  return provider === 'claude' ? { ...presentation, indicator: 'none' } : presentation
}
