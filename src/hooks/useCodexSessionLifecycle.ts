import { useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  CodexApprovalRequest,
  CodexNotification,
  CodexState,
  CodexThread,
  CodexThreadRuntime,
  CodexUserInputRequest,
} from '@shared/ipc'
import type { TodoItem } from '../components/chat/TodoDock'
import { hydratePersistedCodexSession } from './useCodexSessionPersistence'
import { routeCodexNotification } from './codex-session-event-routing'
import { syncCodexThreadRuntimeImpl } from './codex-session-runtime-sync'
import type { useCodexSessionRefs } from './useCodexSessionRefs'
import type { CodexMessageItem } from './codex-session-types'
import type { SubagentInfo } from './codex-subagent-helpers'

type CodexSessionRefs = ReturnType<typeof useCodexSessionRefs>

type UseCodexSessionLifecycleOptions = {
  activeSubagentThreadId: string | null
  getCurrentCodexRuntime: () => {
    runtimeSnapshot?: CodexThreadRuntime | null
    thread?: CodexThread | null
  } | null
  handleNotification: (notification: CodexNotification) => void
  hasPendingPlanReview: boolean
  isStreaming: boolean
  messages: CodexMessageItem[]
  pendingApproval: CodexApprovalRequest | null
  pendingUserInput: CodexUserInputRequest | null
  recordLastError: (error: unknown, statusOverride?: CodexState['status']) => void
  refs: CodexSessionRefs
  sessionKey: string
  setActiveSubagentThreadIdState: (
    next: string | null | ((previous: string | null) => string | null)
  ) => void
  setCodexRuntimeSnapshot: (sessionKey: string, snapshot: CodexThreadRuntime | null) => void
  setConnectionState: (
    status: CodexState['status'],
    nextServerInfo?: CodexState['serverInfo'],
    nextLastError?: string
  ) => void
  setMessagesState: (
    next: CodexMessageItem[] | ((previous: CodexMessageItem[]) => CodexMessageItem[])
  ) => void
  setPendingApprovalState: (next: CodexApprovalRequest | null) => void
  setPendingUserInputState: (next: CodexUserInputRequest | null) => void
  setPlanItemsState: (next: TodoItem[]) => void
  setStreamingState: (next: boolean) => void
  setSubagentsState: (
    next: SubagentInfo[] | ((previous: SubagentInfo[]) => SubagentInfo[])
  ) => void
  setThreadNameState: (next: string | undefined) => void
  setThreadState: (next: CodexThread | null) => void
  subagents: SubagentInfo[]
  thread: CodexThread | null
}

function useHydrateCodexSession({
  refs,
  sessionKey,
  setActiveSubagentThreadIdState,
  setMessagesState,
  setPendingApprovalState,
  setPendingUserInputState,
  setPlanItemsState,
  setStreamingState,
  setSubagentsState,
  setThreadNameState,
  setThreadState,
}: Pick<
  UseCodexSessionLifecycleOptions,
  | 'refs'
  | 'sessionKey'
  | 'setActiveSubagentThreadIdState'
  | 'setMessagesState'
  | 'setPendingApprovalState'
  | 'setPendingUserInputState'
  | 'setPlanItemsState'
  | 'setStreamingState'
  | 'setSubagentsState'
  | 'setThreadNameState'
  | 'setThreadState'
>) {
  useEffect(() => {
    hydratePersistedCodexSession(sessionKey, {
      resetRefs: persistedMessageIdCounter => {
        refs.subagentThreadIdsRef.current.clear()
        refs.activeTurnIdRef.current = null
        refs.interruptRequestedRef.current = false
        refs.currentReasoningIdRef.current = null
        refs.thinkingItemIdRef.current = null
        refs.activeExploreGroupIdRef.current = null
        refs.latestPlanUpdateIdRef.current = null
        refs.messageIdCounterRef.current = persistedMessageIdCounter
        refs.pendingInterruptRef.current = false
        refs.commandDiffSnapshotsRef.current.clear()
        refs.itemThreadIdsRef.current.clear()
        refs.turnThreadIdsRef.current.clear()
      },
      setActiveSubagentThreadIdState,
      setMessagesState,
      setPendingApprovalState,
      setPendingUserInputState,
      setPlanItemsState: next => setPlanItemsState(next),
      setStreamingState,
      setSubagentsState: next => setSubagentsState(next),
      setThreadNameState,
      setThreadState,
    })
  }, [
    refs,
    sessionKey,
    setActiveSubagentThreadIdState,
    setMessagesState,
    setPendingApprovalState,
    setPendingUserInputState,
    setPlanItemsState,
    setStreamingState,
    setSubagentsState,
    setThreadNameState,
    setThreadState,
  ])
}

function useCodexEventSubscription({
  getCurrentCodexRuntime,
  handleNotification,
  refs,
  setActiveSubagentThreadIdState,
  setConnectionState,
  setPendingApprovalState,
  setPendingUserInputState,
  setSubagentsState,
}: Pick<
  UseCodexSessionLifecycleOptions,
  | 'getCurrentCodexRuntime'
  | 'handleNotification'
  | 'refs'
  | 'setActiveSubagentThreadIdState'
  | 'setConnectionState'
  | 'setPendingApprovalState'
  | 'setPendingUserInputState'
  | 'setSubagentsState'
>) {
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    if (!window.orxa?.events) return

    const unsubscribe = window.orxa.events.subscribe(event => {
      if (!isMounted.current) return

      if (event.type === 'codex.state') {
        const state = event.payload as CodexState
        setConnectionState(state.status, state.serverInfo, state.lastError)
        return
      }

      if (event.type === 'codex.approval') {
        const approval = event.payload as CodexApprovalRequest
        const currentThreadId = getCurrentCodexRuntime()?.thread?.id
        if (!approval.threadId || !currentThreadId || approval.threadId === currentThreadId) {
          setPendingApprovalState(approval)
        }
        return
      }

      if (event.type === 'codex.userInput') {
        const input = event.payload as CodexUserInputRequest
        const currentThreadId = getCurrentCodexRuntime()?.thread?.id
        if (!input.threadId || !currentThreadId || input.threadId === currentThreadId) {
          setPendingUserInputState(input)
        }
        return
      }

      if (event.type === 'codex.notification') {
        const notification = event.payload as CodexNotification
        const result = routeCodexNotification({
          activeTurnIdRef: refs.activeTurnIdRef,
          activeThreadId: getCurrentCodexRuntime()?.thread?.id ?? null,
          itemThreadIdsRef: refs.itemThreadIdsRef,
          notification,
          setActiveSubagentThreadIdState,
          setSubagentsState,
          subagentThreadIds: refs.subagentThreadIdsRef,
          turnThreadIdsRef: refs.turnThreadIdsRef,
        })
        if (result === 'dispatch') {
          handleNotification(notification)
        }
      }
    })

    return () => {
      isMounted.current = false
      unsubscribe()
    }
  }, [
    getCurrentCodexRuntime,
    handleNotification,
    refs,
    setActiveSubagentThreadIdState,
    setConnectionState,
    setPendingApprovalState,
    setPendingUserInputState,
    setSubagentsState,
  ])
}

function useCodexThreadRuntimeSync({
  getCurrentCodexRuntime,
  hasPendingPlanReview,
  isStreaming,
  pendingApproval,
  pendingUserInput,
  recordLastError,
  refs,
  sessionKey,
  setCodexRuntimeSnapshot,
  setStreamingState,
  setSubagentsState,
  subagents,
  thread,
}: Pick<
  UseCodexSessionLifecycleOptions,
  | 'getCurrentCodexRuntime'
  | 'hasPendingPlanReview'
  | 'isStreaming'
  | 'pendingApproval'
  | 'pendingUserInput'
  | 'recordLastError'
  | 'refs'
  | 'sessionKey'
  | 'setCodexRuntimeSnapshot'
  | 'setStreamingState'
  | 'setSubagentsState'
  | 'subagents'
  | 'thread'
>) {
  const syncCodexThreadRuntime = useCallback(
    () =>
      syncCodexThreadRuntimeImpl({
        activeTurnIdRef: refs.activeTurnIdRef,
        getCurrentCodexRuntime,
        interruptRequestedRef: refs.interruptRequestedRef,
        pendingInterruptRef: refs.pendingInterruptRef,
        recordLastError,
        sessionKey,
        setCodexRuntimeSnapshot,
        setStreamingState,
        setSubagentsState,
        subagentThreadIds: refs.subagentThreadIdsRef,
      }),
    [
      getCurrentCodexRuntime,
      recordLastError,
      refs,
      sessionKey,
      setCodexRuntimeSnapshot,
      setStreamingState,
      setSubagentsState,
    ]
  )

  useEffect(() => {
    if (!thread?.id) return

    const hasBlockingInteraction =
      hasPendingPlanReview || Boolean(pendingApproval) || Boolean(pendingUserInput)
    if (!hasBlockingInteraction) {
      void syncCodexThreadRuntime()
    }

    const hasActiveBackgroundWork =
      isStreaming ||
      subagents.some(
        agent => agent.status === 'thinking' || agent.status === 'awaiting_instruction'
      )
    const onResume = () => void syncCodexThreadRuntime()
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('pageshow', onResume)

    if (!hasActiveBackgroundWork || hasBlockingInteraction) {
      return () => {
        document.removeEventListener('visibilitychange', onResume)
        window.removeEventListener('focus', onResume)
        window.removeEventListener('pageshow', onResume)
      }
    }

    const timer = window.setInterval(() => void syncCodexThreadRuntime(), 1500)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('pageshow', onResume)
    }
  }, [
    hasPendingPlanReview,
    isStreaming,
    pendingApproval,
    pendingUserInput,
    subagents,
    syncCodexThreadRuntime,
    thread?.id,
  ])
}

function useCodexSubagentMessages(
  activeSubagentThreadId: string | null,
  messages: CodexMessageItem[]
) {
  return useMemo(() => {
    if (!activeSubagentThreadId) return []
    return messages.filter(message => {
      if (message.kind !== 'tool' || message.toolType !== 'task') return false
      if (message.collabReceivers?.some(receiver => receiver.threadId === activeSubagentThreadId)) {
        return true
      }
      return message.collabSender?.threadId === activeSubagentThreadId
    })
  }, [activeSubagentThreadId, messages])
}

export function useCodexSessionLifecycle(options: UseCodexSessionLifecycleOptions) {
  useHydrateCodexSession(options)
  useCodexEventSubscription(options)
  useCodexThreadRuntimeSync(options)
  return {
    subagentMessages: useCodexSubagentMessages(
      options.activeSubagentThreadId,
      options.messages
    ),
  }
}
