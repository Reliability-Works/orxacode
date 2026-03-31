import { useCallback } from 'react'
import type {
  CodexNotification,
  CodexThread,
  CodexThreadRuntime,
} from '@shared/ipc'
import type { TodoItem } from '../components/chat/TodoDock'
import { appendDeltaToMappedItem } from './codex-session-message-reducers'
import {
  applyCollabSubagentHints,
  collectCollabSubagentHints,
} from './codex-session-notification-helpers'
import {
  attributeCommandFileChangesForDirectory,
  captureCommandDiffSnapshotForDirectory,
} from './codex-session-command-diff'
import { dispatchCodexNotification } from './codex-session-notification-dispatch'
import { enrichFileChangeDescriptors as enrichFileChangeDescriptorsImpl } from './codex-session-file-enrichment'
import type { FileChangeDescriptor } from './codex-diff-helpers'
import type { SubagentInfo } from './codex-subagent-helpers'
import type { CodexMessageItem } from './codex-session-types'
import type { useCodexSessionRefs } from './useCodexSessionRefs'

const COMMAND_DIFF_POLL_INTERVAL_MS = 850

type CodexSessionRefs = ReturnType<typeof useCodexSessionRefs>

type UseCodexSessionDiffTrackingOptions = {
  directory: string
  getCurrentCodexRuntime: () => {
    messages: CodexMessageItem[]
    runtimeSnapshot?: CodexThreadRuntime | null
    thread: CodexThread | null
  } | null
  recordLastError: (
    error: unknown,
    statusOverride?: 'disconnected' | 'connecting' | 'connected' | 'error'
  ) => void
  refs: CodexSessionRefs
  setMessagesState: (
    next: CodexMessageItem[] | ((previous: CodexMessageItem[]) => CodexMessageItem[])
  ) => void
  setPlanItemsState: (next: TodoItem[]) => void
  setStreamingState: (next: boolean) => void
  setSubagentsState: (
    next: SubagentInfo[] | ((previous: SubagentInfo[]) => SubagentInfo[])
  ) => void
  setThreadNameState: (next: string | undefined) => void
  updateMessages: (
    updater: (previous: CodexMessageItem[]) => CodexMessageItem[],
    priority?: 'normal' | 'deferred'
  ) => void
}

function useAppendToItemField(
  codexItemToMsgIdRef: CodexSessionRefs['codexItemToMsgIdRef'],
  updateMessages: UseCodexSessionDiffTrackingOptions['updateMessages']
) {
  return useCallback(
    (codexItemId: string, field: 'content' | 'output' | 'diff' | 'summary', delta: string) => {
      const msgId = codexItemToMsgIdRef.current.get(codexItemId)
      if (!msgId) return
      updateMessages(prev => appendDeltaToMappedItem(prev, msgId, field, delta), 'deferred')
    },
    [codexItemToMsgIdRef, updateMessages]
  )
}

function useCommandDiffSnapshot(
  directory: string,
  updateMessages: UseCodexSessionDiffTrackingOptions['updateMessages']
) {
  const readProjectFileContent = useCallback(
    async (relativePath: string) => {
      if (!window.orxa?.opencode) return null
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
    () =>
      captureCommandDiffSnapshotForDirectory(
        directory,
        window.orxa?.opencode,
        readProjectFileContent
      ),
    [directory, readProjectFileContent]
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

  return { captureCommandDiffSnapshot, enrichFileChangeDescriptors, readProjectFileContent, updateMessages }
}

function useCommandDiffPolling(
  directory: string,
  readProjectFileContent: (relativePath: string) => Promise<string | null>,
  refs: CodexSessionRefs,
  updateMessages: UseCodexSessionDiffTrackingOptions['updateMessages']
) {
  const attributeCommandFileChanges = useCallback(
    async (
      codexItemId: string,
      anchorMessageId?: string,
      options?: { status?: 'running' | 'completed'; clearBaseline?: boolean }
    ) => {
      if (!window.orxa?.opencode) {
        refs.commandDiffSnapshotsRef.current.delete(codexItemId)
        return
      }

      const baselinePromise = refs.commandDiffSnapshotsRef.current.get(codexItemId)
      const baseline = baselinePromise ? await baselinePromise.catch(() => null) : null
      if (!baseline) {
        if (options?.clearBaseline) {
          refs.commandDiffSnapshotsRef.current.delete(codexItemId)
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
          refs.commandDiffSnapshotsRef.current.delete(codexItemId)
        }
      }
    },
    [directory, readProjectFileContent, refs.commandDiffSnapshotsRef, updateMessages]
  )

  const stopCommandDiffPolling = useCallback(
    (codexItemId: string) => {
      const timerId = refs.commandDiffPollTimersRef.current.get(codexItemId)
      if (timerId !== undefined) {
        window.clearTimeout(timerId)
        refs.commandDiffPollTimersRef.current.delete(codexItemId)
      }
    },
    [refs.commandDiffPollTimersRef]
  )

  const startCommandDiffPolling = useCallback(
    (codexItemId: string, anchorMessageId?: string) => {
      stopCommandDiffPolling(codexItemId)
      const tick = () => {
        void attributeCommandFileChanges(codexItemId, anchorMessageId, { status: 'running' }).finally(() => {
          if (!refs.commandDiffPollTimersRef.current.has(codexItemId)) return
          refs.commandDiffPollTimersRef.current.set(
            codexItemId,
            window.setTimeout(tick, COMMAND_DIFF_POLL_INTERVAL_MS)
          )
        })
      }
      refs.commandDiffPollTimersRef.current.set(
        codexItemId,
        window.setTimeout(tick, COMMAND_DIFF_POLL_INTERVAL_MS)
      )
    },
    [attributeCommandFileChanges, refs.commandDiffPollTimersRef, stopCommandDiffPolling]
  )

  return { attributeCommandFileChanges, startCommandDiffPolling, stopCommandDiffPolling }
}

function useSubagentHintMerge(
  refs: CodexSessionRefs,
  setSubagentsState: UseCodexSessionDiffTrackingOptions['setSubagentsState']
) {
  return useCallback(
    (rawItem: unknown) => {
      const hints = collectCollabSubagentHints(rawItem)
      if (!hints) return
      setSubagentsState(prev =>
        applyCollabSubagentHints(
          prev,
          hints.explicitThreadIds,
          hints.receiverById,
          refs.subagentThreadIdsRef
        )
      )
    },
    [refs.subagentThreadIdsRef, setSubagentsState]
  )
}

function useCodexNotificationHandler(
  options: UseCodexSessionDiffTrackingOptions,
  callbacks: {
    appendToItemField: ReturnType<typeof useAppendToItemField>
    attributeCommandFileChanges: ReturnType<typeof useCommandDiffPolling>['attributeCommandFileChanges']
    captureCommandDiffSnapshot: ReturnType<typeof useCommandDiffSnapshot>['captureCommandDiffSnapshot']
    enrichFileChangeDescriptors: ReturnType<typeof useCommandDiffSnapshot>['enrichFileChangeDescriptors']
    mergeSubagentsFromCollabHints: ReturnType<typeof useSubagentHintMerge>
    startCommandDiffPolling: ReturnType<typeof useCommandDiffPolling>['startCommandDiffPolling']
    stopCommandDiffPolling: ReturnType<typeof useCommandDiffPolling>['stopCommandDiffPolling']
  }
) {
  const {
    directory,
    getCurrentCodexRuntime,
    recordLastError,
    refs,
    setMessagesState,
    setPlanItemsState,
    setStreamingState,
    setSubagentsState,
    setThreadNameState,
    updateMessages,
  } = options

  return useCallback(
    (notification: CodexNotification) => {
      dispatchCodexNotification(notification, {
        activeExploreGroupIdRef: refs.activeExploreGroupIdRef,
        activeTurnIdRef: refs.activeTurnIdRef,
        appendToItemField: callbacks.appendToItemField,
        attributeCommandFileChanges: callbacks.attributeCommandFileChanges,
        captureCommandDiffSnapshot: callbacks.captureCommandDiffSnapshot,
        codexItemToExploreGroupId: refs.codexItemToExploreGroupIdRef,
        codexItemToMsgId: refs.codexItemToMsgIdRef,
        commandDiffSnapshotsRef: refs.commandDiffSnapshotsRef,
        currentReasoningIdRef: refs.currentReasoningIdRef,
        directory,
        enrichFileChangeDescriptors: callbacks.enrichFileChangeDescriptors,
        getCurrentCodexRuntime,
        itemThreadIdsRef: refs.itemThreadIdsRef,
        latestPlanUpdateIdRef: refs.latestPlanUpdateIdRef,
        mergeSubagentsFromCollabHints: callbacks.mergeSubagentsFromCollabHints,
        messageIdCounter: refs.messageIdCounterRef,
        pendingInterruptRef: refs.pendingInterruptRef,
        interruptRequestedRef: refs.interruptRequestedRef,
        recordLastError,
        setMessagesState,
        setPlanItemsState,
        setStreamingState,
        setSubagentsState,
        setThreadNameState,
        startCommandDiffPolling: callbacks.startCommandDiffPolling,
        stopCommandDiffPolling: callbacks.stopCommandDiffPolling,
        streamingItemIdRef: refs.streamingItemIdRef,
        subagentThreadIds: refs.subagentThreadIdsRef,
        thinkingItemIdRef: refs.thinkingItemIdRef,
        turnThreadIdsRef: refs.turnThreadIdsRef,
        updateMessages,
      })
    },
    [
      callbacks.appendToItemField,
      callbacks.attributeCommandFileChanges,
      callbacks.captureCommandDiffSnapshot,
      callbacks.enrichFileChangeDescriptors,
      callbacks.mergeSubagentsFromCollabHints,
      callbacks.startCommandDiffPolling,
      callbacks.stopCommandDiffPolling,
      directory,
      getCurrentCodexRuntime,
      recordLastError,
      refs,
      setMessagesState,
      setPlanItemsState,
      setStreamingState,
      setSubagentsState,
      setThreadNameState,
      updateMessages,
    ]
  )
}

export function useCodexSessionDiffTracking(options: UseCodexSessionDiffTrackingOptions) {
  const appendToItemField = useAppendToItemField(
    options.refs.codexItemToMsgIdRef,
    options.updateMessages
  )
  const snapshot = useCommandDiffSnapshot(options.directory, options.updateMessages)
  const polling = useCommandDiffPolling(
    options.directory,
    snapshot.readProjectFileContent,
    options.refs,
    options.updateMessages
  )
  const mergeSubagentsFromCollabHints = useSubagentHintMerge(
    options.refs,
    options.setSubagentsState
  )

  return {
    appendToItemField,
    attributeCommandFileChanges: polling.attributeCommandFileChanges,
    captureCommandDiffSnapshot: snapshot.captureCommandDiffSnapshot,
    enrichFileChangeDescriptors: snapshot.enrichFileChangeDescriptors,
    handleNotification: useCodexNotificationHandler(options, {
      appendToItemField,
      attributeCommandFileChanges: polling.attributeCommandFileChanges,
      captureCommandDiffSnapshot: snapshot.captureCommandDiffSnapshot,
      enrichFileChangeDescriptors: snapshot.enrichFileChangeDescriptors,
      mergeSubagentsFromCollabHints,
      startCommandDiffPolling: polling.startCommandDiffPolling,
      stopCommandDiffPolling: polling.stopCommandDiffPolling,
    }),
    mergeSubagentsFromCollabHints,
    startCommandDiffPolling: polling.startCommandDiffPolling,
    stopCommandDiffPolling: polling.stopCommandDiffPolling,
  }
}
