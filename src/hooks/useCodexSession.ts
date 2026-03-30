import { useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  CodexApprovalRequest,
  CodexNotification,
  CodexState,
  CodexUserInputRequest,
} from '@shared/ipc'
import { getPersistedCodexState } from './codex-session-storage'
import { appendDeltaToMappedItem } from './codex-session-message-reducers'
import {
  applyCollabSubagentHints,
  collectCollabSubagentHints,
} from './codex-session-notification-helpers'
import {
  hydratePersistedCodexSession,
  useCodexSessionPersistence,
} from './useCodexSessionPersistence'
import { type CommandDiffBaseline, type FileChangeDescriptor } from './codex-diff-helpers'
import {
  attributeCommandFileChangesForDirectory,
  captureCommandDiffSnapshotForDirectory,
} from './codex-session-command-diff'
import { dispatchCodexNotification } from './codex-session-notification-dispatch'
import { syncCodexThreadRuntimeImpl } from './codex-session-runtime-sync'
import { routeCodexNotification } from './codex-session-event-routing'
import { useCodexSessionStore } from './useCodexSessionStore'
import { enrichFileChangeDescriptors as enrichFileChangeDescriptorsImpl } from './codex-session-file-enrichment'
import { useCodexSessionActions } from './codex-session-actions'

export type { CodexMessageRole, CodexMessage, CodexMessageItem, CodexSessionState } from './codex-session-types'
export { agentColor, agentColorForId, type SubagentInfo } from './codex-subagent-helpers'
const COMMAND_DIFF_POLL_INTERVAL_MS = 850
// Hook
export function useCodexSession(
  directory: string,
  sessionKey: string,
  codexOptions?: { codexPath?: string; codexArgs?: string }
) {
  const store = useCodexSessionStore(sessionKey)
  const {
    connectionStatus,
    serverInfo,
    thread,
    messages,
    pendingApproval,
    pendingUserInput,
    isStreaming,
    lastError,
    threadName,
    planItems,
    dismissedPlanIds,
    subagents,
    activeSubagentThreadId,
    hasPendingPlanReview,
    updateMessages,
    setMessagesState,
    setThreadState,
    setPendingApprovalState,
    setPendingUserInputState,
    setStreamingState,
    setThreadNameState,
    setPlanItemsState,
    setDismissedPlanIdsState,
    setSubagentsState,
    setActiveSubagentThreadIdState,
    setConnectionState,
    recordLastError,
    clearLastError,
    initCodexSession,
    setCodexRuntimeSnapshot,
    getCurrentCodexRuntime,
  } = store

  const subagentThreadIds = useRef(new Set<string>())

  // Track the current assistant message being streamed
  const streamingItemIdRef = useRef<string | null>(null)
  // Track the thinking item id so we can remove it on turn/completed
  const thinkingItemIdRef = useRef<string | null>(null)
  const persistedMessageIdCounter = getPersistedCodexState(sessionKey).messageIdCounter
  const messageIdCounter = useRef(persistedMessageIdCounter)
  // Map codex item IDs to our message IDs for delta matching
  const codexItemToMsgId = useRef(new Map<string, string>())
  // Map codex item IDs to the explore group message ID they belong to
  const codexItemToExploreGroupId = useRef(new Map<string, string>())
  // Track the active explore group so we can append to it even when non-explore items are inserted between
  const activeExploreGroupIdRef = useRef<string | null>(null)
  // Track the single reasoning message for the current turn (only one visible at a time)
  const currentReasoningIdRef = useRef<string | null>(null)
  // Track active turn for interrupt
  const activeTurnIdRef = useRef<string | null>(null)
  const pendingInterruptRef = useRef(false)
  const interruptRequestedRef = useRef(false)
  const latestPlanUpdateIdRef = useRef<string | null>(null)
  const itemThreadIdsRef = useRef(new Map<string, string>())
  const turnThreadIdsRef = useRef(new Map<string, string>())
  const commandDiffSnapshotsRef = useRef(new Map<string, Promise<CommandDiffBaseline | null>>())
  const commandDiffPollTimersRef = useRef(new Map<string, number>())

  useCodexSessionPersistence({
    directory,
    sessionKey,
    messages,
    thread,
    isStreaming,
    messageIdCounterRef: messageIdCounter,
    commandDiffPollTimersRef,
    initCodexSession,
    getCurrentCodexRuntime,
  })

  // ------------------------------------------------------------------
  // Helper: find and update a message by its internal msg ID
  // ------------------------------------------------------------------
  const appendToItemField = useCallback(
    (codexItemId: string, field: 'content' | 'output' | 'diff' | 'summary', delta: string) => {
      const msgId = codexItemToMsgId.current.get(codexItemId)
      if (!msgId) return
      updateMessages(prev => appendDeltaToMappedItem(prev, msgId, field, delta), 'deferred')
    },
    [updateMessages]
  )

  const readProjectFileContent = useCallback(
    async (relativePath: string) => {
      if (!window.orxa?.opencode) {
        return null
      }
      try {
        const document = await window.orxa.opencode.readProjectFile(directory, relativePath)
        return document.binary ? null : document.content
      } catch {
        return null
      }
    },
    [directory]
  )

  const captureCommandDiffSnapshot = useCallback(
    async () =>
      captureCommandDiffSnapshotForDirectory(
        directory,
        window.orxa?.opencode,
        readProjectFileContent
      ),
    [directory, readProjectFileContent]
  )

  const attributeCommandFileChanges = useCallback(
    async (
      codexItemId: string,
      anchorMessageId?: string,
      options?: { status?: 'running' | 'completed'; clearBaseline?: boolean }
    ) => {
      if (!window.orxa?.opencode) {
        commandDiffSnapshotsRef.current.delete(codexItemId)
        return
      }
      const baselinePromise = commandDiffSnapshotsRef.current.get(codexItemId)
      const baseline = baselinePromise ? await baselinePromise.catch(() => null) : null
      if (!baseline) {
        if (options?.clearBaseline) {
          commandDiffSnapshotsRef.current.delete(codexItemId)
        }
        return
      }

      try {
        await attributeCommandFileChangesForDirectory({
          anchorMessageId,
          baseline,
          codexItemId,
          directory,
          opencode: window.orxa?.opencode,
          options,
          readProjectFileContent,
          updateMessages,
        })
      } finally {
        if (options?.clearBaseline) {
          commandDiffSnapshotsRef.current.delete(codexItemId)
        }
      }
    },
    [directory, readProjectFileContent, updateMessages]
  )

  const enrichFileChangeDescriptors = useCallback(
    (descriptors: FileChangeDescriptor[]) =>
      enrichFileChangeDescriptorsImpl(
        descriptors,
        directory,
        readProjectFileContent,
        window.orxa?.opencode
      ),
    [directory, readProjectFileContent]
  )

  const stopCommandDiffPolling = useCallback((codexItemId: string) => {
    const timerId = commandDiffPollTimersRef.current.get(codexItemId)
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      commandDiffPollTimersRef.current.delete(codexItemId)
    }
  }, [])

  const startCommandDiffPolling = useCallback(
    (codexItemId: string, anchorMessageId?: string) => {
      stopCommandDiffPolling(codexItemId)
      const tick = () => {
        void attributeCommandFileChanges(codexItemId, anchorMessageId, {
          status: 'running',
        }).finally(() => {
          if (!commandDiffPollTimersRef.current.has(codexItemId)) {
            return
          }
          const nextTimer = window.setTimeout(tick, COMMAND_DIFF_POLL_INTERVAL_MS)
          commandDiffPollTimersRef.current.set(codexItemId, nextTimer)
        })
      }
      const firstTimer = window.setTimeout(tick, COMMAND_DIFF_POLL_INTERVAL_MS)
      commandDiffPollTimersRef.current.set(codexItemId, firstTimer)
    },
    [attributeCommandFileChanges, stopCommandDiffPolling]
  )

  const mergeSubagentsFromCollabHints = useCallback(
    (rawItem: unknown) => {
      const hints = collectCollabSubagentHints(rawItem)
      if (!hints) {
        return
      }

      setSubagentsState(prev => {
        return applyCollabSubagentHints(
          prev,
          hints.explicitThreadIds,
          hints.receiverById,
          subagentThreadIds
        )
      })
    },
    [setSubagentsState]
  )

  // ------------------------------------------------------------------
  // Notification handler
  // ------------------------------------------------------------------
  const handleNotification = useCallback(
    (notification: CodexNotification) => {
      dispatchCodexNotification(notification, {
        pendingInterruptRef,
        interruptRequestedRef,
        activeTurnIdRef,
        streamingItemIdRef,
        currentReasoningIdRef,
        thinkingItemIdRef,
        activeExploreGroupIdRef,
        codexItemToMsgId,
        codexItemToExploreGroupId,
        messageIdCounter,
        commandDiffSnapshotsRef,
        latestPlanUpdateIdRef,
        subagentThreadIds,
        itemThreadIdsRef,
        turnThreadIdsRef,
        setStreamingState,
        setMessagesState,
        updateMessages,
        setPlanItemsState,
        setSubagentsState,
        setThreadNameState,
        recordLastError,
        getCurrentCodexRuntime,
        captureCommandDiffSnapshot,
        startCommandDiffPolling,
        stopCommandDiffPolling,
        attributeCommandFileChanges,
        enrichFileChangeDescriptors,
        mergeSubagentsFromCollabHints,
        appendToItemField,
        directory,
      })
    },
    [
      appendToItemField,
      attributeCommandFileChanges,
      captureCommandDiffSnapshot,
      directory,
      enrichFileChangeDescriptors,
      getCurrentCodexRuntime,
      mergeSubagentsFromCollabHints,
      recordLastError,
      setMessagesState,
      setPlanItemsState,
      setStreamingState,
      startCommandDiffPolling,
      setSubagentsState,
      setThreadNameState,
      stopCommandDiffPolling,
      updateMessages,
    ]
  )

  // ------------------------------------------------------------------
  // Event subscription
  // Uses a mounted ref to avoid setState on unmounted components.
  // The notification handler writes to persisted state via normal setState paths.
  // ------------------------------------------------------------------
  const isMounted = useRef(true)
  useEffect(() => {
    isMounted.current = true
    hydratePersistedCodexSession(sessionKey, {
      setMessagesState,
      setThreadState,
      setStreamingState,
      setPendingApprovalState,
      setPendingUserInputState,
      setSubagentsState: next => setSubagentsState(next),
      setActiveSubagentThreadIdState,
      setPlanItemsState: next => setPlanItemsState(next),
      setThreadNameState,
      resetRefs: persistedMessageIdCounter => {
        subagentThreadIds.current.clear()
        activeTurnIdRef.current = null
        interruptRequestedRef.current = false
        currentReasoningIdRef.current = null
        thinkingItemIdRef.current = null
        activeExploreGroupIdRef.current = null
        latestPlanUpdateIdRef.current = null
        messageIdCounter.current = persistedMessageIdCounter
        pendingInterruptRef.current = false
        commandDiffSnapshotsRef.current.clear()
        itemThreadIdsRef.current.clear()
        turnThreadIdsRef.current.clear()
      },
    })

    if (!window.orxa?.events) {
      return
    }

    const unsubscribe = window.orxa.events.subscribe(event => {
      if (!isMounted.current) {
        return
      }

      if (event.type === 'codex.state') {
        const state = event.payload as CodexState
        setConnectionState(state.status, state.serverInfo, state.lastError)
      }

      if (event.type === 'codex.approval') {
        const approval = event.payload as CodexApprovalRequest
        const currentThreadId = getCurrentCodexRuntime()?.thread?.id
        if (!approval.threadId || !currentThreadId || approval.threadId === currentThreadId) {
          setPendingApprovalState(approval)
        }
      }

      if (event.type === 'codex.userInput') {
        const input = event.payload as CodexUserInputRequest
        const currentThreadId = getCurrentCodexRuntime()?.thread?.id
        if (!input.threadId || !currentThreadId || input.threadId === currentThreadId) {
          setPendingUserInputState(input)
        }
      }

      if (event.type === 'codex.notification') {
        const notification = event.payload as CodexNotification
        const result = routeCodexNotification({
          notification,
          activeThreadId: getCurrentCodexRuntime()?.thread?.id ?? null,
          activeTurnIdRef,
          subagentThreadIds,
          itemThreadIdsRef,
          turnThreadIdsRef,
          setActiveSubagentThreadIdState,
          setSubagentsState,
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
    setConnectionState,
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

  const syncCodexThreadRuntime = useCallback(
    () =>
      syncCodexThreadRuntimeImpl({
        getCurrentCodexRuntime,
        activeTurnIdRef,
        pendingInterruptRef,
        interruptRequestedRef,
        subagentThreadIds,
        recordLastError,
        setStreamingState,
        setSubagentsState,
        setCodexRuntimeSnapshot,
        sessionKey,
      }),
    [
      getCurrentCodexRuntime,
      recordLastError,
      sessionKey,
      setCodexRuntimeSnapshot,
      setStreamingState,
      setSubagentsState,
    ]
  )

  useEffect(() => {
    if (!thread?.id) {
      return
    }

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
    const onResume = () => {
      void syncCodexThreadRuntime()
    }
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
    const pollIntervalMs = 1500
    const timer = window.setInterval(() => {
      void syncCodexThreadRuntime()
    }, pollIntervalMs)

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

  // Derive subagent messages reactively from current messages
  const subagentMessages = useMemo(() => {
    if (!activeSubagentThreadId) return []
    return messages.filter(m => {
      if (m.kind !== 'tool' || m.toolType !== 'task') return false
      const receivers = m.collabReceivers
      const sender = m.collabSender
      if (receivers?.some(r => r.threadId === activeSubagentThreadId)) return true
      if (sender?.threadId === activeSubagentThreadId) return true
      return false
    })
  }, [messages, activeSubagentThreadId])

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  const actions = useCodexSessionActions({
    directory,
    codexOptions,
    serverInfo,
    thread,
    pendingApproval,
    pendingUserInput,
    // Refs
    activeTurnIdRef,
    thinkingItemIdRef,
    pendingInterruptRef,
    interruptRequestedRef,
    messageIdCounterRef: messageIdCounter,
    streamingItemIdRef,
    codexItemToMsgIdRef: codexItemToMsgId,
    codexItemToExploreGroupIdRef: codexItemToExploreGroupId,
    activeExploreGroupIdRef,
    currentReasoningIdRef,
    latestPlanUpdateIdRef,
    subagentThreadIdsRef: subagentThreadIds,
    commandDiffSnapshotsRef,
    // Callbacks
    setConnectionState,
    setThreadState,
    setMessagesState,
    setStreamingState,
    setPendingApprovalState,
    setPendingUserInputState,
    setPlanItemsState,
    setDismissedPlanIdsState,
    setSubagentsState,
    setActiveSubagentThreadIdState,
    setThreadNameState,
    recordLastError,
    clearLastError,
    updateMessages,
  })

  // Check if a thread is a subagent thread
  const isSubagentThread = useCallback((threadId: string) => {
    return subagentThreadIds.current.has(threadId)
  }, [])

  return {
    connectionStatus,
    serverInfo,
    thread,
    messages,
    pendingApproval,
    pendingUserInput,
    isStreaming,
    lastError,
    threadName,
    planItems,
    dismissedPlanIds,
    subagents,
    activeSubagentThreadId,
    subagentMessages,
    ...actions,
    isSubagentThread,
  }
}
