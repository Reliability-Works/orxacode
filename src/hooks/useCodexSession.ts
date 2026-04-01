import { useCallback } from 'react'
import { useCodexSessionPersistence } from './useCodexSessionPersistence'
import { useCodexSessionStore } from './useCodexSessionStore'
import { useCodexSessionActions } from './codex-session-actions'
import { useCodexSessionRefs } from './useCodexSessionRefs'
import { useCodexSessionDiffTracking } from './useCodexSessionDiffTracking'
import { useCodexSessionLifecycle } from './useCodexSessionLifecycle'

export type {
  CodexMessageRole,
  CodexMessage,
  CodexMessageItem,
  CodexSessionState,
} from './codex-session-types'
export { agentColor, agentColorForId, type SubagentInfo } from './codex-subagent-helpers'

function buildUseCodexSessionResult(
  store: ReturnType<typeof useCodexSessionStore>,
  actions: ReturnType<typeof useCodexSessionActions>,
  subagentMessages: ReturnType<typeof useCodexSessionLifecycle>['subagentMessages'],
  isSubagentThread: (threadId: string) => boolean
) {
  return {
    activeSubagentThreadId: store.activeSubagentThreadId,
    connectionStatus: store.connectionStatus,
    dismissedPlanIds: store.dismissedPlanIds,
    hasPendingPlanReview: store.hasPendingPlanReview,
    isStreaming: store.isStreaming,
    isSubagentThread,
    lastError: store.lastError,
    messages: store.messages,
    pendingApproval: store.pendingApproval,
    pendingUserInput: store.pendingUserInput,
    planItems: store.planItems,
    serverInfo: store.serverInfo,
    subagentMessages,
    subagents: store.subagents,
    thread: store.thread,
    threadName: store.threadName,
    ...actions,
  }
}

export function useCodexSession(
  directory: string,
  sessionKey: string,
  codexOptions?: { codexPath?: string; codexArgs?: string }
) {
  const store = useCodexSessionStore(sessionKey)
  const refs = useCodexSessionRefs(sessionKey)

  useCodexSessionPersistence({
    commandDiffPollTimersRef: refs.commandDiffPollTimersRef,
    directory,
    getCurrentCodexRuntime: store.getCurrentCodexRuntime,
    initCodexSession: store.initCodexSession,
    isStreaming: store.isStreaming,
    messageIdCounterRef: refs.messageIdCounterRef,
    messages: store.messages,
    sessionKey,
    thread: store.thread,
  })

  const diffTracking = useCodexSessionDiffTracking({
    directory,
    getCurrentCodexRuntime: store.getCurrentCodexRuntime,
    recordLastError: store.recordLastError,
    refs,
    setMessagesState: store.setMessagesState,
    setPlanItemsState: store.setPlanItemsState,
    setStreamingState: store.setStreamingState,
    setObservedTurnUsage: (turnId, total, timestamp) =>
      store.setObservedTurnUsage(sessionKey, turnId, total, timestamp),
    setSubagentsState: store.setSubagentsState,
    setThreadNameState: store.setThreadNameState,
    updateMessages: store.updateMessages,
  })

  const { subagentMessages } = useCodexSessionLifecycle({
    activeSubagentThreadId: store.activeSubagentThreadId,
    getCurrentCodexRuntime: store.getCurrentCodexRuntime,
    handleNotification: diffTracking.handleNotification,
    hasPendingPlanReview: store.hasPendingPlanReview,
    isStreaming: store.isStreaming,
    messages: store.messages,
    pendingApproval: store.pendingApproval,
    pendingUserInput: store.pendingUserInput,
    recordLastError: store.recordLastError,
    refs,
    sessionKey,
    setActiveSubagentThreadIdState: store.setActiveSubagentThreadIdState,
    setCodexRuntimeSnapshot: store.setCodexRuntimeSnapshot,
    setConnectionState: store.setConnectionState,
    setMessagesState: store.setMessagesState,
    setPendingApprovalState: store.setPendingApprovalState,
    setPendingUserInputState: store.setPendingUserInputState,
    setPlanItemsState: store.setPlanItemsState,
    setStreamingState: store.setStreamingState,
    setSubagentsState: store.setSubagentsState,
    setThreadNameState: store.setThreadNameState,
    setThreadState: store.setThreadState,
    subagents: store.subagents,
    thread: store.thread,
  })

  const actions = useCodexSessionActions({
    activeExploreGroupIdRef: refs.activeExploreGroupIdRef,
    activeTurnIdRef: refs.activeTurnIdRef,
    clearLastError: store.clearLastError,
    codexItemToExploreGroupIdRef: refs.codexItemToExploreGroupIdRef,
    codexItemToMsgIdRef: refs.codexItemToMsgIdRef,
    codexOptions,
    commandDiffSnapshotsRef: refs.commandDiffSnapshotsRef,
    currentReasoningIdRef: refs.currentReasoningIdRef,
    directory,
    interruptRequestedRef: refs.interruptRequestedRef,
    latestPlanUpdateIdRef: refs.latestPlanUpdateIdRef,
    messageIdCounterRef: refs.messageIdCounterRef,
    pendingApproval: store.pendingApproval,
    pendingInterruptRef: refs.pendingInterruptRef,
    pendingUserInput: store.pendingUserInput,
    recordLastError: store.recordLastError,
    serverInfo: store.serverInfo,
    setActiveSubagentThreadIdState: store.setActiveSubagentThreadIdState,
    setConnectionState: store.setConnectionState,
    setDismissedPlanIdsState: store.setDismissedPlanIdsState,
    setMessagesState: store.setMessagesState,
    setPendingApprovalState: store.setPendingApprovalState,
    setPendingUserInputState: store.setPendingUserInputState,
    setPlanItemsState: store.setPlanItemsState,
    setStreamingState: store.setStreamingState,
    setSubagentsState: store.setSubagentsState,
    setThreadNameState: store.setThreadNameState,
    setThreadState: store.setThreadState,
    streamingItemIdRef: refs.streamingItemIdRef,
    subagentThreadIdsRef: refs.subagentThreadIdsRef,
    thinkingItemIdRef: refs.thinkingItemIdRef,
    thread: store.thread,
    updateMessages: store.updateMessages,
  })

  const isSubagentThread = useCallback(
    (threadId: string) => refs.subagentThreadIdsRef.current.has(threadId),
    [refs.subagentThreadIdsRef]
  )

  return buildUseCodexSessionResult(store, actions, subagentMessages, isSubagentThread)
}
