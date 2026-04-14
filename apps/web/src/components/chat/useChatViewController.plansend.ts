/**
 * Plan/send actions + remaining callbacks extracted from useChatViewController.
 */

import { useCallback, useEffect } from 'react'
import { type ThreadId } from '@orxa-code/contracts'
import { useChatSendInFlight, useChatSendAction } from './useChatSendAction'
import { useChatSubmitPlanFollowUp, useChatImplementPlanInNewThread } from './useChatPlanActions'
import { usePersistThreadSettings } from './useChatViewBehavior2'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { useChatViewDerivedThread } from './useChatViewDerivedThread'
import type { useChatViewDerivedActivities } from './useChatViewDerivedActivities'
import type { useChatViewDerivedPlan } from './useChatViewDerivedPlan'
import type { useChatScrollBehavior } from './useChatScrollBehavior'
import type { useComposerDraftCallbacks } from './useChatViewBehavior1'
import type { useLocalDispatchState } from './useChatViewController.effects'
import type { DraftThreadEnvMode } from '../../composerDraftStore'
import {
  usePromptChangeCallback,
  useComposerDragHandlers,
  buildComposerCommandKey,
  buildOnRevertUserMessage,
  buildRemoveComposerImage,
} from './useChatViewBehavior3'
import type { ParsedStandaloneComposerSlashCommand } from '../../composer-logic'
import { executeSend } from './useChatSendAction.execute'
import { revokeQueuedComposerMessage, type QueuedComposerMessage } from './queuedComposerMessages'
import { readNativeApi } from '~/nativeApi'

type S = ReturnType<typeof useChatViewStoreSelectors>
type L = ReturnType<typeof useChatViewLocalState>
type T = ReturnType<typeof useChatViewDerivedThread>
type A = ReturnType<typeof useChatViewDerivedActivities>
type P = ReturnType<typeof useChatViewDerivedPlan>

function usePlanActions(args: {
  store: S
  ls: L
  td: T
  p: P
  scroll: ReturnType<typeof useChatScrollBehavior>
  ld: ReturnType<typeof useLocalDispatchState>
  setThreadError: (id: ThreadId | null, error: string | null) => void
  sendInFlightRef: React.MutableRefObject<boolean>
  persistThreadSettingsForNextTurn: ReturnType<typeof usePersistThreadSettings>
}) {
  const { store, ls, td, p, scroll, ld, setThreadError, sendInFlightRef } = args
  const planActionBase = {
    activeProposedPlan: p.activeProposedPlan,
    isServerThread: td.isServerThread,
    isSendBusy: ld.isSendBusy,
    isConnecting: false as const,
    selectedProvider: td.selectedProvider,
    selectedModel: td.selectedModel,
    selectedProviderModels: td.selectedProviderModels,
    selectedPromptEffort: td.selectedPromptEffort,
    selectedModelSelection: td.selectedModelSelection,
    runtimeMode: td.runtimeMode,
    sendInFlightRef,
    beginLocalDispatch: ld.beginLocalDispatch,
    resetLocalDispatch: ld.resetLocalDispatch,
  }
  const onSubmitPlanFollowUp = useChatSubmitPlanFollowUp({
    ...planActionBase,
    activeThread: td.activeThread ?? null,
    setThreadError,
    setOptimisticUserMessages: ls.setOptimisticUserMessages,
    forceStickToBottom: scroll.forceStickToBottom,
    setComposerDraftInteractionMode: store.setComposerDraftInteractionMode,
    persistThreadSettingsForNextTurn: args.persistThreadSettingsForNextTurn,
  })
  const onImplementPlanInNewThread = useChatImplementPlanInNewThread({
    ...planActionBase,
    activeThread: td.activeThread ?? null,
    activeProject: td.activeProject ?? null,
    navigate: store.navigate,
  })
  return { onSubmitPlanFollowUp, onImplementPlanInNewThread }
}

export type PlanAndSendActionsInput = {
  threadId: ThreadId
  store: S
  ls: L
  td: T
  ad: A
  p: P
  scroll: ReturnType<typeof useChatScrollBehavior>
  ld: ReturnType<typeof useLocalDispatchState>
  envMode: DraftThreadEnvMode
  setThreadError: (id: ThreadId | null, error: string | null) => void
  setPrompt: (s: string) => void
  onExecuteStandaloneSlashCommand: (
    command: ParsedStandaloneComposerSlashCommand
  ) => Promise<boolean> | boolean
  composerDraftCbs: ReturnType<typeof useComposerDraftCallbacks>
  runProjectScript: (
    script: { id: string; command: string; name: string },
    opts?: import('./useChatTerminalActions').RunScriptOptions
  ) => Promise<void>
  persistThreadSettingsForNextTurn: ReturnType<typeof usePersistThreadSettings>
  onAdvanceActivePendingUserInput: () => void
}

function buildExecuteSendUiBindings(args: PlanAndSendActionsInput) {
  const { store, ls, ld, scroll } = args
  return {
    shouldAutoScrollRef: scroll.refs.shouldAutoScrollRef,
    composerImagesRef: ls.composerImagesRef,
    composerTerminalContextsRef: ls.composerTerminalContextsRef,
    promptRef: ls.promptRef,
    beginLocalDispatch: ld.beginLocalDispatch,
    resetLocalDispatch: ld.resetLocalDispatch,
    setStoreThreadError: store.setStoreThreadError,
    setStoreThreadBranch: store.setStoreThreadBranch,
    setThreadError: args.setThreadError,
    setOptimisticUserMessages: ls.setOptimisticUserMessages,
    setComposerCursor: ls.setComposerCursor,
    setComposerTrigger: ls.setComposerTrigger,
    setComposerHighlightedItemId: ls.setComposerHighlightedItemId,
    forceStickToBottom: scroll.forceStickToBottom,
    clearComposerDraftContent: store.clearComposerDraftContent,
    addComposerImagesToDraft: args.composerDraftCbs.addComposerImagesToDraft,
    addComposerTerminalContextsToDraft: args.composerDraftCbs.addComposerTerminalContextsToDraft,
    setPrompt: args.setPrompt,
    persistThreadSettingsForNextTurn: args.persistThreadSettingsForNextTurn,
    runProjectScript: args.runProjectScript,
    createWorktreeMutation: store.createWorktreeMutation,
  }
}

function useSendActionWiring(
  args: PlanAndSendActionsInput,
  sendInFlightRef: React.MutableRefObject<boolean>,
  onSubmitPlanFollowUp: ReturnType<typeof useChatSubmitPlanFollowUp>
) {
  const { store, ls, td, ad, p, ld, envMode } = args

  return useChatSendAction({
    activeThread: td.activeThread ?? null,
    activeProject: td.activeProject ?? null,
    isServerThread: td.isServerThread,
    isLocalDraftThread: td.isLocalDraftThread,
    envMode,
    composerImages: store.composerImages,
    composerTerminalContexts: store.composerTerminalContexts,
    selectedProvider: td.selectedProvider,
    selectedModel: td.selectedModel,
    selectedProviderModels: td.selectedProviderModels,
    selectedPromptEffort: td.selectedPromptEffort,
    selectedModelSelection: td.selectedModelSelection,
    runtimeMode: td.runtimeMode,
    interactionMode: td.interactionMode,
    isSendBusy: ld.isSendBusy,
    isTurnRunning: td.phase === 'running' || !ad.latestTurnSettled,
    isConnecting: false,
    queuedMessageCount: ls.queuedComposerMessages.length,
    queueFollowUp: message => ls.setQueuedComposerMessages(existing => [...existing, message]),
    showPlanFollowUpPrompt: p.showPlanFollowUpPrompt,
    activeProposedPlan: p.activeProposedPlan,
    activePendingProgress: ad.activePendingProgress,
    sendInFlightRef,
    ...buildExecuteSendUiBindings(args),
    onExecuteStandaloneSlashCommand: args.onExecuteStandaloneSlashCommand,
    onSubmitPlanFollowUp,
    onAdvanceActivePendingUserInput: args.onAdvanceActivePendingUserInput,
  })
}

function useQueuedMessageSender(
  args: PlanAndSendActionsInput,
  sendInFlightRef: React.MutableRefObject<boolean>
) {
  const { td, envMode } = args
  return useCallback(
    async (message: QueuedComposerMessage) => {
      const api = readNativeApi()
      if (!api) {
        revokeQueuedComposerMessage(message)
        return
      }
      if (!td.activeThread || !td.activeProject) {
        revokeQueuedComposerMessage(message)
        return
      }
      await executeSend({
        api,
        activeThread: td.activeThread,
        activeProject: td.activeProject,
        isServerThread: td.isServerThread,
        isLocalDraftThread: td.isLocalDraftThread,
        envMode,
        composerImages: message.images,
        composerTerminalContexts: message.terminalContexts,
        promptForSend: message.prompt,
        trimmed: message.trimmed,
        selectedProvider: message.selectedProvider,
        selectedModel: message.selectedModel,
        selectedProviderModels: td.selectedProviderModels,
        selectedPromptEffort: message.selectedPromptEffort,
        selectedModelSelection: message.selectedModelSelection,
        runtimeMode: message.runtimeMode,
        interactionMode: message.interactionMode,
        expiredTerminalContextCount: 0,
        sendInFlightRef,
        ...buildExecuteSendUiBindings(args),
      })
    },
    [args, envMode, sendInFlightRef, td]
  )
}

export function useChatViewPlanAndSendActions(args: PlanAndSendActionsInput) {
  const sendInFlightRef = useChatSendInFlight()
  const queuedComposerMessage = args.ls.queuedComposerMessages[0] ?? null
  const planActions = usePlanActions({
    store: args.store,
    ls: args.ls,
    td: args.td,
    p: args.p,
    scroll: args.scroll,
    ld: args.ld,
    setThreadError: args.setThreadError,
    sendInFlightRef,
    persistThreadSettingsForNextTurn: args.persistThreadSettingsForNextTurn,
  })
  const onSend = useSendActionWiring(args, sendInFlightRef, planActions.onSubmitPlanFollowUp)
  const sendQueuedMessage = useQueuedMessageSender(args, sendInFlightRef)
  useEffect(() => {
    if (!queuedComposerMessage) {
      return
    }
    if (args.ld.isSendBusy || args.td.phase === 'running' || !args.ad.latestTurnSettled) {
      return
    }
    args.ls.setQueuedComposerMessages(messages => messages.slice(1))
    void sendQueuedMessage(queuedComposerMessage)
  }, [
    args.ad.latestTurnSettled,
    args.ld.isSendBusy,
    args.ls,
    args.td.phase,
    queuedComposerMessage,
    sendQueuedMessage,
  ])
  // Codex-only: after a short grace window, inject the head queued message
  // into the still-running turn via `turn/steer` (our manager's `sendTurn`
  // picks the steer path automatically when the session has an active turn).
  // The grace window gives the user time to edit or remove the message in the
  // queued tray before it dispatches. Claude and Opencode skip this because
  // their providers can't accept mid-turn injection.
  useEffect(() => {
    if (!queuedComposerMessage || queuedComposerMessage.selectedProvider !== 'codex') {
      return
    }
    if (args.ld.isSendBusy || args.td.phase !== 'running') {
      return
    }
    const CODEX_STEER_GRACE_MS = 1500
    const timer = window.setTimeout(() => {
      args.ls.setQueuedComposerMessages(messages =>
        messages[0]?.id === queuedComposerMessage.id ? messages.slice(1) : messages
      )
      void sendQueuedMessage(queuedComposerMessage)
    }, CODEX_STEER_GRACE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [args.ld.isSendBusy, args.ls, args.td.phase, queuedComposerMessage, sendQueuedMessage])
  return { sendInFlightRef, ...planActions, onSend }
}

export function useChatViewRemainingCallbacks(args: {
  threadId: ThreadId
  store: S
  ls: L
  ad: A
  td: T
  callbacksCore: ReturnType<
    typeof import('./useChatViewController.callbacks').useChatViewCallbacksCore
  >
  planSendActions: ReturnType<typeof useChatViewPlanAndSendActions>
  composerDraftCbs: ReturnType<typeof useComposerDraftCallbacks>
  setPrompt: (s: string) => void
  focusComposer: () => void
  addComposerImages: (files: File[]) => void
}) {
  const { threadId, store, ls, ad, td, callbacksCore, planSendActions, composerDraftCbs } = args
  const onPromptChange = usePromptChangeCallback(
    threadId,
    ls,
    store,
    ad,
    args.setPrompt,
    callbacksCore.onChangeActivePendingUserInputCustomAnswer,
    td.selectedProvider
  )
  const resolveActiveComposerTrigger = useCallback(() => {
    const snapshot = callbacksCore.readComposerSnapshot()
    return { snapshot, trigger: ls.composerTrigger }
  }, [callbacksCore, ls.composerTrigger])
  const onComposerCommandKey = useCallback(
    (key: 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Tab', event: KeyboardEvent): boolean => {
      return buildComposerCommandKey({
        composerMenuOpenRef: ls.composerMenuOpenRef,
        composerMenuItemsRef: ls.composerMenuItemsRef,
        activeComposerMenuItemRef: ls.activeComposerMenuItemRef,
        nudgeComposerMenuHighlight: callbacksCore.nudgeComposerMenuHighlight,
        onSelectComposerItem: callbacksCore.onSelectComposerItem as (item: {
          id: string
          type: string
          [k: string]: unknown
        }) => void,
        resolveActiveComposerTrigger,
        toggleInteractionMode: callbacksCore.toggleInteractionMode,
        onSend: planSendActions.onSend,
      })(key, event)
    },
    [callbacksCore, ls, planSendActions.onSend, resolveActiveComposerTrigger]
  )
  const onRevertUserMessage = useCallback(
    (messageId: string): void => {
      buildOnRevertUserMessage(
        ad.revertTurnCountByUserMessageId,
        callbacksCore.onRevertToTurnCount
      )(messageId)
    },
    [ad.revertTurnCountByUserMessageId, callbacksCore.onRevertToTurnCount]
  )
  const removeComposerImage = useCallback(
    (imageId: string) => {
      buildRemoveComposerImage(composerDraftCbs.removeComposerImage)(imageId)
    },
    [composerDraftCbs.removeComposerImage]
  )
  const dragHandlers = useComposerDragHandlers(ls, args.addComposerImages, args.focusComposer)
  return {
    onPromptChange,
    resolveActiveComposerTrigger,
    onComposerCommandKey,
    onRevertUserMessage,
    removeComposerImage,
    ...dragHandlers,
  }
}
