import { startTransition, useCallback, useMemo } from 'react'
import type {
  CodexApprovalRequest,
  CodexState,
  CodexThread,
  CodexUserInputRequest,
} from '@shared/ipc'
import type { TodoItem } from '../components/chat/TodoDock'
import type { CodexMessageItem } from './codex-session-types'
import type { SubagentInfo } from './codex-subagent-helpers'
import { getPersistedCodexState } from './codex-session-storage'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSameSubagentInfo(left: SubagentInfo, right: SubagentInfo) {
  return (
    left.threadId === right.threadId &&
    left.nickname === right.nickname &&
    left.role === right.role &&
    left.status === right.status &&
    left.statusText === right.statusText &&
    left.spawnedAt === right.spawnedAt
  )
}

function areSameSubagentInfos(left: SubagentInfo[], right: SubagentInfo[]) {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  return left.every((agent, index) => isSameSubagentInfo(agent, right[index]!))
}

function computeHasPendingPlanReview(
  messages: CodexMessageItem[],
  dismissedPlanIds: Set<string>,
  isStreaming: boolean
): boolean {
  if (isStreaming) {
    return false
  }
  let lastPlanIdx = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.kind === 'tool' && message.toolType === 'plan') {
      lastPlanIdx = index
      break
    }
  }
  if (lastPlanIdx < 0) {
    return false
  }
  const planMessage = messages[lastPlanIdx]
  if (planMessage.kind !== 'tool') {
    return false
  }
  if (
    !planMessage.output ||
    planMessage.output.trim().length === 0 ||
    planMessage.status === 'error'
  ) {
    return false
  }
  if (dismissedPlanIds.has(planMessage.id)) {
    return false
  }
  return !messages
    .slice(lastPlanIdx + 1)
    .some(message => message.kind === 'message' && message.role === 'user')
}

function hasRuntimeHydratedData(runtime: NonNullable<ReturnType<typeof useUnifiedRuntimeStore.getState>['codexSessions'][string]>): boolean {
  if (runtime.connectionStatus !== 'disconnected') return true
  if (runtime.serverInfo !== undefined) return true
  if (runtime.lastError !== undefined) return true
  if (runtime.thread !== undefined) return true
  if (runtime.runtimeSnapshot !== undefined) return true
  if (runtime.messages.length > 0) return true
  if (runtime.pendingApproval !== undefined) return true
  if (runtime.pendingUserInput !== undefined) return true
  if (runtime.isStreaming) return true
  if (runtime.planItems.length > 0) return true
  if (runtime.dismissedPlanIds.length > 0) return true
  if (runtime.subagents.length > 0) return true
  if (runtime.activeSubagentThreadId !== undefined) return true
  if (runtime.threadName !== undefined) return true
  return false
}

// ---------------------------------------------------------------------------
// Derived State Hook
// ---------------------------------------------------------------------------

function useCodexSessionCoreState(sessionKey: string) {
  const persisted = getPersistedCodexState(sessionKey)
  const codexRuntime = useUnifiedRuntimeStore(state => state.codexSessions[sessionKey] ?? null)

  const hasHydratedCodexRuntime = Boolean(codexRuntime && hasRuntimeHydratedData(codexRuntime))
  const runtimeState = hasHydratedCodexRuntime ? codexRuntime : null

  return {
    persisted,
    runtimeState,
    hasHydratedCodexRuntime,
  }
}

function useCodexSessionBasicDerivedState(sessionKey: string) {
  const { persisted, runtimeState } = useCodexSessionCoreState(sessionKey)

  return {
    connectionStatus: runtimeState?.connectionStatus ?? 'disconnected',
    serverInfo: runtimeState?.serverInfo,
    thread: runtimeState?.thread ?? persisted.thread,
    messages: runtimeState?.messages ?? persisted.messages,
    pendingApproval: runtimeState?.pendingApproval ?? null,
    pendingUserInput: runtimeState?.pendingUserInput ?? null,
    isStreaming: runtimeState?.isStreaming ?? persisted.isStreaming,
    lastError: runtimeState?.lastError,
    threadName: runtimeState?.threadName,
    planItems: runtimeState?.planItems ?? [],
  }
}

function useCodexSessionComputedState(
  runtimeState: ReturnType<typeof useCodexSessionCoreState>['runtimeState']
) {
  const dismissedPlanIds = useMemo(
    () => new Set(runtimeState?.dismissedPlanIds ?? []),
    [runtimeState?.dismissedPlanIds]
  )
  const subagents = useMemo(() => runtimeState?.subagents ?? [], [runtimeState?.subagents])
  const activeSubagentThreadId = runtimeState?.activeSubagentThreadId ?? null

  return {
    dismissedPlanIds,
    subagents,
    activeSubagentThreadId,
  }
}

function useCodexSessionDerivedState(sessionKey: string) {
  const { persisted, runtimeState, hasHydratedCodexRuntime } = useCodexSessionCoreState(sessionKey)
  const basicState = useCodexSessionBasicDerivedState(sessionKey)
  const { dismissedPlanIds, subagents, activeSubagentThreadId } =
    useCodexSessionComputedState(runtimeState)

  const hasPendingPlanReview = useMemo(
    () => computeHasPendingPlanReview(basicState.messages, dismissedPlanIds, basicState.isStreaming),
    [dismissedPlanIds, basicState.isStreaming, basicState.messages]
  )

  return {
    ...basicState,
    dismissedPlanIds,
    subagents,
    activeSubagentThreadId,
    hasPendingPlanReview,
    hasHydratedCodexRuntime,
    persisted,
  }
}

// ---------------------------------------------------------------------------
// Setters Hook - Part 1: Basic Setters
// ---------------------------------------------------------------------------

function useCodexSessionBasicSetters(sessionKey: string) {
  const setCodexThread = useUnifiedRuntimeStore(state => state.setCodexThread)
  const replaceCodexMessages = useUnifiedRuntimeStore(state => state.replaceCodexMessages)
  const updateCodexMessages = useUnifiedRuntimeStore(state => state.updateCodexMessages)
  const setCodexPendingApproval = useUnifiedRuntimeStore(state => state.setCodexPendingApproval)
  const setCodexPendingUserInput = useUnifiedRuntimeStore(state => state.setCodexPendingUserInput)
  const setCodexStreaming = useUnifiedRuntimeStore(state => state.setCodexStreaming)
  const setCodexThreadName = useUnifiedRuntimeStore(state => state.setCodexThreadName)
  const setCodexPlanItems = useUnifiedRuntimeStore(state => state.setCodexPlanItems)

  const updateMessages = useCallback(
    (
      updater: (previous: CodexMessageItem[]) => CodexMessageItem[],
      priority: 'normal' | 'deferred' = 'normal'
    ) => {
      if (priority === 'deferred') {
        startTransition(() => {
          updateCodexMessages(sessionKey, updater)
        })
        return
      }
      updateCodexMessages(sessionKey, updater)
    },
    [sessionKey, updateCodexMessages]
  )

  const setMessagesState = useCallback(
    (next: CodexMessageItem[] | ((previous: CodexMessageItem[]) => CodexMessageItem[])) => {
      if (typeof next === 'function') {
        updateCodexMessages(sessionKey, next)
        return
      }
      replaceCodexMessages(sessionKey, next)
    },
    [replaceCodexMessages, sessionKey, updateCodexMessages]
  )

  const setThreadState = useCallback(
    (next: CodexThread | null) => {
      setCodexThread(sessionKey, next)
    },
    [sessionKey, setCodexThread]
  )

  const setPendingApprovalState = useCallback(
    (next: CodexApprovalRequest | null) => {
      setCodexPendingApproval(sessionKey, next)
    },
    [sessionKey, setCodexPendingApproval]
  )

  const setPendingUserInputState = useCallback(
    (next: CodexUserInputRequest | null) => {
      setCodexPendingUserInput(sessionKey, next)
    },
    [sessionKey, setCodexPendingUserInput]
  )

  const setStreamingState = useCallback(
    (next: boolean) => {
      setCodexStreaming(sessionKey, next)
    },
    [sessionKey, setCodexStreaming]
  )

  const setThreadNameState = useCallback(
    (next: string | undefined) => {
      setCodexThreadName(sessionKey, next)
    },
    [sessionKey, setCodexThreadName]
  )

  const setPlanItemsState = useCallback(
    (next: TodoItem[]) => {
      setCodexPlanItems(sessionKey, next)
    },
    [sessionKey, setCodexPlanItems]
  )

  return {
    updateMessages,
    setMessagesState,
    setThreadState,
    setPendingApprovalState,
    setPendingUserInputState,
    setStreamingState,
    setThreadNameState,
    setPlanItemsState,
    replaceCodexMessages,
  }
}

// ---------------------------------------------------------------------------
// Setters Hook - Part 2: Complex Setters
// ---------------------------------------------------------------------------

function useCodexSessionComplexSetters(sessionKey: string) {
  const setCodexConnectionState = useUnifiedRuntimeStore(state => state.setCodexConnectionState)
  const setCodexDismissedPlanIds = useUnifiedRuntimeStore(state => state.setCodexDismissedPlanIds)
  const setCodexSubagents = useUnifiedRuntimeStore(state => state.setCodexSubagents)
  const setCodexActiveSubagentThreadId = useUnifiedRuntimeStore(
    state => state.setCodexActiveSubagentThreadId
  )

  const getCurrentCodexRuntime = useCallback(
    () => useUnifiedRuntimeStore.getState().codexSessions[sessionKey] ?? null,
    [sessionKey]
  )

  const setDismissedPlanIdsState = useCallback(
    (next: Set<string> | ((previous: Set<string>) => Set<string>)) => {
      const previous = new Set(
        useUnifiedRuntimeStore.getState().codexSessions[sessionKey]?.dismissedPlanIds ?? []
      )
      const resolved = typeof next === 'function' ? next(previous) : next
      setCodexDismissedPlanIds(sessionKey, [...resolved])
    },
    [sessionKey, setCodexDismissedPlanIds]
  )

  const setSubagentsState = useCallback(
    (next: SubagentInfo[] | ((previous: SubagentInfo[]) => SubagentInfo[])) => {
      const previous = useUnifiedRuntimeStore.getState().codexSessions[sessionKey]?.subagents ?? []
      const resolved = typeof next === 'function' ? next(previous) : next
      if (areSameSubagentInfos(previous, resolved)) {
        return
      }
      setCodexSubagents(sessionKey, resolved)
    },
    [sessionKey, setCodexSubagents]
  )

  const setActiveSubagentThreadIdState = useCallback(
    (next: string | null | ((previous: string | null) => string | null)) => {
      const previous =
        useUnifiedRuntimeStore.getState().codexSessions[sessionKey]?.activeSubagentThreadId ?? null
      const resolved = typeof next === 'function' ? next(previous) : next
      setCodexActiveSubagentThreadId(sessionKey, resolved)
    },
    [sessionKey, setCodexActiveSubagentThreadId]
  )

  const setConnectionState = useCallback(
    (
      status: CodexState['status'],
      nextServerInfo?: CodexState['serverInfo'],
      nextLastError?: string
    ) => {
      setCodexConnectionState(sessionKey, status, nextServerInfo, nextLastError)
    },
    [sessionKey, setCodexConnectionState]
  )

  const recordLastError = useCallback(
    (error: unknown, statusOverride?: CodexState['status']) => {
      const currentRuntime = useUnifiedRuntimeStore.getState().codexSessions[sessionKey]
      setCodexConnectionState(
        sessionKey,
        statusOverride ?? currentRuntime?.connectionStatus ?? 'error',
        currentRuntime?.serverInfo,
        error instanceof Error ? error.message : String(error)
      )
    },
    [sessionKey, setCodexConnectionState]
  )

  const clearLastError = useCallback(() => {
    const currentRuntime = useUnifiedRuntimeStore.getState().codexSessions[sessionKey]
    if (!currentRuntime?.lastError) {
      return
    }
    setCodexConnectionState(
      sessionKey,
      currentRuntime.connectionStatus,
      currentRuntime.serverInfo,
      undefined
    )
  }, [sessionKey, setCodexConnectionState])

  return {
    setDismissedPlanIdsState,
    setSubagentsState,
    setActiveSubagentThreadIdState,
    setConnectionState,
    recordLastError,
    clearLastError,
    getCurrentCodexRuntime,
  }
}

// ---------------------------------------------------------------------------
// Setters Hook - Part 3: Store Actions
// ---------------------------------------------------------------------------

function useCodexSessionStoreActions() {
  const initCodexSession = useUnifiedRuntimeStore(state => state.initCodexSession)
  const setCodexRuntimeSnapshot = useUnifiedRuntimeStore(state => state.setCodexRuntimeSnapshot)

  return {
    initCodexSession,
    setCodexRuntimeSnapshot,
  }
}

// ---------------------------------------------------------------------------
// Main Setters Hook
// ---------------------------------------------------------------------------

function useCodexSessionSetters(sessionKey: string) {
  const basic = useCodexSessionBasicSetters(sessionKey)
  const complex = useCodexSessionComplexSetters(sessionKey)
  const actions = useCodexSessionStoreActions()

  return {
    ...basic,
    ...complex,
    ...actions,
  }
}

// ---------------------------------------------------------------------------
// Main Hook
// ---------------------------------------------------------------------------

export function useCodexSessionStore(sessionKey: string) {
  const state = useCodexSessionDerivedState(sessionKey)
  const setters = useCodexSessionSetters(sessionKey)
  return { ...state, ...setters }
}
