/**
 * Plan/send actions + remaining callbacks extracted from useChatViewController.
 */

import { useCallback } from 'react'
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
    setPlanSidebarOpen: ls.setPlanSidebarOpen,
    planSidebarDismissedForTurnRef: ls.planSidebarDismissedForTurnRef,
    setComposerDraftInteractionMode: store.setComposerDraftInteractionMode,
    persistThreadSettingsForNextTurn: args.persistThreadSettingsForNextTurn,
  })
  const onImplementPlanInNewThread = useChatImplementPlanInNewThread({
    ...planActionBase,
    activeThread: td.activeThread ?? null,
    activeProject: td.activeProject ?? null,
    planSidebarOpenOnNextThreadRef: ls.planSidebarOpenOnNextThreadRef,
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
  handleInteractionModeChange: (
    mode: import('@orxa-code/contracts').ProviderInteractionMode
  ) => void
  composerDraftCbs: ReturnType<typeof useComposerDraftCallbacks>
  runProjectScript: (
    script: { id: string; command: string; name: string },
    opts?: import('./useChatTerminalActions').RunScriptOptions
  ) => Promise<void>
  persistThreadSettingsForNextTurn: ReturnType<typeof usePersistThreadSettings>
  onAdvanceActivePendingUserInput: () => void
}

function useSendActionWiring(
  args: PlanAndSendActionsInput,
  sendInFlightRef: React.MutableRefObject<boolean>,
  onSubmitPlanFollowUp: ReturnType<typeof useChatSubmitPlanFollowUp>
) {
  const { store, ls, td, ad, p, scroll, ld, envMode } = args
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
    isConnecting: false,
    showPlanFollowUpPrompt: p.showPlanFollowUpPrompt,
    activeProposedPlan: p.activeProposedPlan,
    activePendingProgress: ad.activePendingProgress,
    sendInFlightRef,
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
    handleInteractionModeChange: args.handleInteractionModeChange,
    onSubmitPlanFollowUp,
    onAdvanceActivePendingUserInput: args.onAdvanceActivePendingUserInput,
    persistThreadSettingsForNextTurn: args.persistThreadSettingsForNextTurn,
    runProjectScript: args.runProjectScript,
    createWorktreeMutation: store.createWorktreeMutation,
  })
}

export function useChatViewPlanAndSendActions(args: PlanAndSendActionsInput) {
  const sendInFlightRef = useChatSendInFlight()
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
