/**
 * ChatView orchestrator hook.
 *
 * Aggregates all extracted sub-hooks for ChatView into a single object.
 * Sub-functions are extracted into sibling files to respect per-function
 * and per-file line limits.
 */

import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  type ThreadId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from '@orxa-code/contracts'
import { gitBranchesQueryOptions } from '~/lib/gitReactQuery'
import { projectScriptCwd, projectScriptRuntimeEnv } from '../../projectScripts'
import { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import { useChatViewLocalState } from './useChatViewLocalState'
import { useChatViewDerivedThread } from './useChatViewDerivedThread'
import { useChatViewDerivedActivities } from './useChatViewDerivedActivities'
import { useChatViewDerivedPlan } from './useChatViewDerivedPlan'
import { useChatViewDerivedComposer } from './useChatViewDerivedComposer'
import { useChatScrollBehavior } from './useChatScrollBehavior'
import { useChatTerminalFocusEffect } from './useChatTerminalActions'
import {
  useCoreUtilCallbacks,
  useComposerDraftCallbacks,
  usePullRequestCallbacks,
  useAttachmentPreviewCallbacks,
} from './useChatViewBehavior1'
import { buildComposerImages } from './useChatViewBehavior2'
import {
  useLocalDispatchState,
  useChatViewCoreEffects,
  useChatViewOptimisticMessageEffect,
  deriveEnvMode,
  deriveScrollInput,
} from './useChatViewController.effects'
import { useChatViewCallbacksCore } from './useChatViewController.callbacks'
import {
  useChatViewPlanAndSendActions,
  useChatViewRemainingCallbacks,
} from './useChatViewController.plansend'

function useBuildAddComposerImages(
  store: ReturnType<typeof useChatViewStoreSelectors>,
  td: ReturnType<typeof useChatViewDerivedThread>,
  ad: ReturnType<typeof useChatViewDerivedActivities>,
  composerDraftCbs: ReturnType<typeof useComposerDraftCallbacks>,
  setThreadError: (id: ThreadId | null, error: string | null) => void
) {
  return useCallback(
    (files: File[]) => {
      buildComposerImages(files, {
        activeThreadId: td.activeThreadId,
        pendingUserInputsLength: ad.pendingUserInputs.length,
        composerImagesLength: store.composerImages.length,
        addComposerImage: composerDraftCbs.addComposerImage,
        addComposerImagesToDraft: composerDraftCbs.addComposerImagesToDraft,
        setThreadError,
        maxAttachments: PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
        maxImageBytes: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
      })
    },
    [
      td.activeThreadId,
      ad.pendingUserInputs.length,
      store.composerImages.length,
      composerDraftCbs,
      setThreadError,
    ]
  )
}

function useChatViewControllerState(threadId: ThreadId) {
  const store = useChatViewStoreSelectors(threadId)
  const ls = useChatViewLocalState(store.prompt)
  const td = useChatViewDerivedThread(threadId, store, ls)
  const ad = useChatViewDerivedActivities(store, ls, td)
  const p = useChatViewDerivedPlan(td, ad)
  const gitCwd = td.activeProject
    ? projectScriptCwd({
        project: { cwd: td.activeProject.cwd },
        worktreePath: td.activeThread?.worktreePath ?? null,
      })
    : null
  const cd = useChatViewDerivedComposer(store, ls, td, gitCwd)
  const branchesQuery = useQuery(gitBranchesQueryOptions(gitCwd))
  const scroll = useChatScrollBehavior(deriveScrollInput(ad, td, p))
  return { store, ls, td, ad, p, cd, gitCwd, branchesQuery, scroll }
}

function useChatViewControllerUtilsAndDispatch(
  threadId: ThreadId,
  state: ReturnType<typeof useChatViewControllerState>
) {
  const { store, ls, td, ad } = state
  const { setThreadError, focusComposer, scheduleComposerFocus, setPrompt } = useCoreUtilCallbacks(
    threadId,
    store,
    ls
  )
  const composerDraftCbs = useComposerDraftCallbacks(threadId, store, ls, td, ad, setPrompt)
  const { clearAttachmentPreviewHandoffs, handoffAttachmentPreviews } =
    useAttachmentPreviewCallbacks(ls)
  const ld = useLocalDispatchState(
    td.activeThread,
    td.phase,
    td.activeLatestTurn,
    ad.activePendingApproval,
    ad.activePendingUserInput,
    td.activeThread?.error
  )
  return {
    setThreadError,
    focusComposer,
    scheduleComposerFocus,
    setPrompt,
    composerDraftCbs,
    clearAttachmentPreviewHandoffs,
    handoffAttachmentPreviews,
    ld,
  }
}

function useChatViewControllerEffectsWiring(
  state: ReturnType<typeof useChatViewControllerState>,
  focusComposer: () => void,
  handoffAttachmentPreviews: (messageId: string, previewUrls: string[]) => void
) {
  const { store, ls, td, cd } = state
  useChatTerminalFocusEffect(
    td.activeThreadId,
    store.terminalState.terminalOpen,
    ls.setTerminalFocusRequestId,
    focusComposer
  )
  useChatViewCoreEffects({
    activeThreadId: td.activeThreadId,
    phase: td.phase,
    composerImages: store.composerImages,
    composerTerminalContexts: store.composerTerminalContexts,
    composerMenuOpen: cd.composerMenuOpen,
    composerMenuItems: cd.composerMenuItems,
    activeComposerMenuItem: cd.activeComposerMenuItem,
    ls,
    prompt: store.prompt,
    terminalOpen: store.terminalState.terminalOpen,
    focusComposer,
  })
  useChatViewOptimisticMessageEffect(
    td.activeThreadId,
    td.activeThread?.messages,
    ls.optimisticUserMessages,
    ls.setOptimisticUserMessages,
    handoffAttachmentPreviews
  )
}

function useThreadTerminalEnvAndCloseSidebar(state: ReturnType<typeof useChatViewControllerState>) {
  const { td, ls, p } = state
  const threadTerminalRuntimeEnv = useMemo(() => {
    if (!td.activeProject?.cwd) return {}
    return projectScriptRuntimeEnv({
      project: { cwd: td.activeProject.cwd },
      worktreePath: td.activeThread?.worktreePath ?? null,
    })
  }, [td.activeProject, td.activeThread])
  const closePlanSidebar = useCallback(() => {
    ls.setPlanSidebarOpen(false)
    const turnKey = p.activePlan?.turnId ?? p.sidebarProposedPlan?.turnId ?? null
    if (turnKey) ls.setPlanSidebarDismissedForTurn(turnKey)
  }, [ls, p.activePlan, p.sidebarProposedPlan])
  return { threadTerminalRuntimeEnv, closePlanSidebar }
}

function useChatViewControllerActions(
  threadId: ThreadId,
  state: ReturnType<typeof useChatViewControllerState>,
  utils: ReturnType<typeof useChatViewControllerUtilsAndDispatch>
) {
  const { store, ls, td, ad, p, cd, scroll } = state
  const { setThreadError, focusComposer, scheduleComposerFocus, setPrompt, composerDraftCbs, ld } =
    utils
  const callbacksCore = useChatViewCallbacksCore(
    threadId,
    store,
    ls,
    td,
    ad,
    p,
    cd,
    setThreadError,
    setPrompt,
    scheduleComposerFocus
  )
  const envMode = deriveEnvMode(
    td.activeThread,
    td.isLocalDraftThread,
    store.draftThread?.envMode ?? null
  )
  const planSendActions = useChatViewPlanAndSendActions({
    threadId,
    store,
    ls,
    td,
    ad,
    p,
    scroll,
    ld,
    envMode,
    setThreadError,
    setPrompt,
    handleInteractionModeChange: callbacksCore.handleInteractionModeChange,
    composerDraftCbs,
    runProjectScript: callbacksCore.runProjectScript as (
      script: { id: string; command: string; name: string },
      opts?: import('./useChatTerminalActions').RunScriptOptions
    ) => Promise<void>,
    persistThreadSettingsForNextTurn: callbacksCore.persistThreadSettingsForNextTurn,
    onAdvanceActivePendingUserInput: callbacksCore.onAdvanceActivePendingUserInput,
  })
  const pullRequestCbs = usePullRequestCallbacks(threadId, store, ls, td)
  const addComposerImages = useBuildAddComposerImages(
    store,
    td,
    ad,
    composerDraftCbs,
    setThreadError
  )
  const remainingCbs = useChatViewRemainingCallbacks({
    threadId,
    store,
    ls,
    ad,
    callbacksCore,
    planSendActions,
    composerDraftCbs,
    setPrompt,
    focusComposer,
    addComposerImages,
  })
  return { callbacksCore, planSendActions, pullRequestCbs, addComposerImages, remainingCbs }
}

export function useChatViewController(threadId: ThreadId) {
  const state = useChatViewControllerState(threadId)
  const utils = useChatViewControllerUtilsAndDispatch(threadId, state)
  const actions = useChatViewControllerActions(threadId, state, utils)
  useChatViewControllerEffectsWiring(state, utils.focusComposer, utils.handoffAttachmentPreviews)
  const { threadTerminalRuntimeEnv, closePlanSidebar } = useThreadTerminalEnvAndCloseSidebar(state)
  const { store, ls, td, ad, p, cd, gitCwd, branchesQuery, scroll } = state
  return {
    threadId,
    store,
    ls,
    td,
    ad,
    p,
    cd,
    scroll,
    ld: utils.ld,
    gitCwd,
    branchesQuery,
    threadTerminalRuntimeEnv,
    setThreadError: utils.setThreadError,
    focusComposer: utils.focusComposer,
    scheduleComposerFocus: utils.scheduleComposerFocus,
    setPrompt: utils.setPrompt,
    ...utils.composerDraftCbs,
    clearAttachmentPreviewHandoffs: utils.clearAttachmentPreviewHandoffs,
    handoffAttachmentPreviews: utils.handoffAttachmentPreviews,
    ...actions.callbacksCore,
    ...actions.planSendActions,
    ...actions.pullRequestCbs,
    addComposerImages: actions.addComposerImages,
    ...actions.remainingCbs,
    closePlanSidebar,
  }
}
