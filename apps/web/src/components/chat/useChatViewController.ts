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
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from '@orxa-code/contracts'
import { gitBranchesQueryOptions, gitPanelDiffQueryOptions } from '~/lib/gitReactQuery'
import { projectScriptCwd, projectScriptRuntimeEnv } from '../../projectScripts'
import { collapseExpandedComposerCursor } from '../../composer-logic'
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
import { toastManager } from '../ui/toastState'
import { useQueuedComposerMessageCallbacks } from './useChatViewController.queued'
import {
  buildWorktreeHandoffContext,
  resolveHandoffTargetProviderArgument,
  startThreadHandoff,
} from './ThreadHandoffMenu.helpers'

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
  const panelDiffQuery = useQuery(gitPanelDiffQueryOptions(cd.isGitRepo ? gitCwd : null))
  const scroll = useChatScrollBehavior(deriveScrollInput(ad, td, p))
  return { store, ls, td, ad, p, cd, gitCwd, branchesQuery, panelDiffQuery, scroll }
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
  const { td, ls } = state
  const threadTerminalRuntimeEnv = useMemo(() => {
    if (!td.activeProject?.cwd) return {}
    return projectScriptRuntimeEnv({
      project: { cwd: td.activeProject.cwd },
      worktreePath: td.activeThread?.worktreePath ?? null,
    })
  }, [td.activeProject, td.activeThread])
  const toggleAuxSidebar = useCallback(
    (mode: 'git' | 'files' | 'browser') => {
      ls.setAuxSidebarMode(current => (current === mode ? 'none' : mode))
    },
    [ls]
  )
  const closeAuxSidebar = useCallback(() => {
    ls.setAuxSidebarMode('none')
  }, [ls])
  return { threadTerminalRuntimeEnv, toggleAuxSidebar, closeAuxSidebar }
}

function showPullRequestHandoffUnavailableToast() {
  toastManager.add({
    type: 'warning',
    title: 'Pull request handoff unavailable',
    description: 'This thread cannot prepare a pull request worktree from the current project.',
  })
}

function showInvalidHandoffTargetToast() {
  toastManager.add({
    type: 'warning',
    title: 'Choose a different target provider',
    description:
      'Use `/handoff codex`, `/handoff claude`, or `/handoff opencode`, excluding the current provider.',
  })
}

function showProviderStatusToast(params: {
  selectedProvider: ReturnType<typeof useChatViewDerivedThread>['selectedProvider']
  activeProviderStatus: ReturnType<typeof useChatViewDerivedThread>['activeProviderStatus']
  rateLimitSummary: string | null
}) {
  const providerLabel = PROVIDER_DISPLAY_NAMES[params.selectedProvider] ?? params.selectedProvider
  const statusMessage =
    params.activeProviderStatus?.message ??
    (params.activeProviderStatus
      ? `${providerLabel} is ${params.activeProviderStatus.status}.`
      : `${providerLabel} status is unavailable.`)
  const description = [statusMessage, params.rateLimitSummary]
    .filter((value): value is string => Boolean(value))
    .join(' ')
  toastManager.add({
    type: params.activeProviderStatus?.status === 'error' ? 'error' : 'info',
    title: `${providerLabel} status`,
    description,
  })
}

async function runStandaloneSlashCommand(args: {
  input: import('../../composer-logic').ParsedStandaloneComposerSlashCommand
  navigate: ReturnType<typeof useChatViewStoreSelectors>['navigate']
  activeProject: ReturnType<typeof useChatViewDerivedThread>['activeProject']
  activeProviderStatus: ReturnType<typeof useChatViewDerivedThread>['activeProviderStatus']
  activeThread: ReturnType<typeof useChatViewDerivedThread>['activeThread']
  canCheckoutPullRequestIntoThread: ReturnType<
    typeof useChatViewDerivedThread
  >['canCheckoutPullRequestIntoThread']
  selectedProvider: ReturnType<typeof useChatViewDerivedThread>['selectedProvider']
  rateLimitSummary: string | null
  callbacksCore: ReturnType<typeof useChatViewCallbacksCore>
  pullRequestCbs: ReturnType<typeof usePullRequestCallbacks>
}) {
  const {
    input,
    navigate,
    activeProject,
    activeProviderStatus,
    activeThread,
    canCheckoutPullRequestIntoThread,
    selectedProvider,
    rateLimitSummary,
    callbacksCore,
    pullRequestCbs,
  } = args
  switch (input.command) {
    case 'plan':
      callbacksCore.handleInteractionModeChange('plan')
      return true
    case 'default':
      callbacksCore.handleInteractionModeChange('default')
      return true
    case 'fork':
      if (!activeThread || !canCheckoutPullRequestIntoThread) {
        showPullRequestHandoffUnavailableToast()
        return true
      }
      pullRequestCbs.openPullRequestDialog(
        input.argument || undefined,
        buildWorktreeHandoffContext(activeThread)
      )
      return true
    case 'handoff': {
      if (!activeThread) return false
      const targetProvider = resolveHandoffTargetProviderArgument(
        activeThread.modelSelection.provider,
        input.argument
      )
      if (!targetProvider) {
        showInvalidHandoffTargetToast()
        return true
      }
      await startThreadHandoff({
        navigate,
        thread: activeThread,
        project: activeProject ?? null,
        targetProvider,
      })
      return true
    }
    case 'status':
      showProviderStatusToast({ selectedProvider, activeProviderStatus, rateLimitSummary })
      return true
    default:
      return false
  }
}

function useStandaloneSlashCommandExecutor(args: {
  store: ReturnType<typeof useChatViewStoreSelectors>
  td: ReturnType<typeof useChatViewDerivedThread>
  ad: ReturnType<typeof useChatViewDerivedActivities>
  callbacksCore: ReturnType<typeof useChatViewCallbacksCore>
  pullRequestCbs: ReturnType<typeof usePullRequestCallbacks>
}) {
  const { callbacksCore, pullRequestCbs } = args
  const { navigate } = args.store
  const {
    activeProject,
    activeProviderStatus,
    activeThread,
    canCheckoutPullRequestIntoThread,
    selectedProvider,
  } = args.td
  const rateLimitSummary = args.ad.activeRateLimits?.summary ?? null
  return useCallback(
    (input: import('../../composer-logic').ParsedStandaloneComposerSlashCommand) =>
      runStandaloneSlashCommand({
        input,
        navigate,
        activeProject,
        activeProviderStatus,
        activeThread,
        canCheckoutPullRequestIntoThread,
        selectedProvider,
        rateLimitSummary,
        callbacksCore,
        pullRequestCbs,
      }),
    [
      activeProject,
      activeProviderStatus,
      activeThread,
      callbacksCore,
      canCheckoutPullRequestIntoThread,
      navigate,
      pullRequestCbs,
      rateLimitSummary,
      selectedProvider,
    ]
  )
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
    cd,
    setThreadError,
    setPrompt,
    scheduleComposerFocus
  )
  const pullRequestCbs = usePullRequestCallbacks(threadId, store, ls, td)
  const onExecuteStandaloneSlashCommand = useStandaloneSlashCommandExecutor({
    store,
    td,
    ad,
    callbacksCore,
    pullRequestCbs,
  })
  const planSendActions = useChatViewPlanAndSendActions({
    threadId,
    store,
    ls,
    td,
    ad,
    p,
    scroll,
    ld,
    envMode: deriveEnvMode(
      td.activeThread,
      td.isLocalDraftThread,
      store.draftThread?.envMode ?? null
    ),
    setThreadError,
    setPrompt,
    onExecuteStandaloneSlashCommand,
    composerDraftCbs,
    runProjectScript: callbacksCore.runProjectScript as (
      script: { id: string; command: string; name: string },
      opts?: import('./useChatTerminalActions').RunScriptOptions
    ) => Promise<void>,
    persistThreadSettingsForNextTurn: callbacksCore.persistThreadSettingsForNextTurn,
    onAdvanceActivePendingUserInput: callbacksCore.onAdvanceActivePendingUserInput,
  })
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
    td,
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
  const queuedMessageActions = useQueuedComposerMessageCallbacks(threadId, state, utils)
  useChatViewControllerEffectsWiring(state, utils.focusComposer, utils.handoffAttachmentPreviews)
  const { threadTerminalRuntimeEnv, toggleAuxSidebar, closeAuxSidebar } =
    useThreadTerminalEnvAndCloseSidebar(state)
  const { store, ls, td, ad, p, cd, gitCwd, branchesQuery, panelDiffQuery, scroll } = state
  const insertComposerPathReference = useCallback(
    (path: string) => {
      const currentPrompt = ls.promptRef.current
      const prefix = currentPrompt.length === 0 || /\s$/.test(currentPrompt) ? '' : ' '
      const nextPrompt = `${currentPrompt}${prefix}@${path} `
      utils.setPrompt(nextPrompt)
      ls.setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length))
      ls.setComposerTrigger(null)
      utils.scheduleComposerFocus()
    },
    [ls, utils]
  )
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
    panelDiffQuery,
    threadTerminalRuntimeEnv,
    setThreadError: utils.setThreadError,
    focusComposer: utils.focusComposer,
    scheduleComposerFocus: utils.scheduleComposerFocus,
    setPrompt: utils.setPrompt,
    ...utils.composerDraftCbs,
    clearAttachmentPreviewHandoffs: utils.clearAttachmentPreviewHandoffs,
    handoffAttachmentPreviews: utils.handoffAttachmentPreviews,
    ...queuedMessageActions,
    ...actions.callbacksCore,
    ...actions.planSendActions,
    ...actions.pullRequestCbs,
    addComposerImages: actions.addComposerImages,
    ...actions.remainingCbs,
    closeAuxSidebar,
    toggleGitSidebar: () => toggleAuxSidebar('git'),
    toggleFilesSidebar: () => toggleAuxSidebar('files'),
    toggleBrowserSidebar: () => toggleAuxSidebar('browser'),
    insertComposerPathReference,
  }
}
