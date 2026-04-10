/**
 * Effects + derived helpers + local dispatch state extracted from
 * useChatViewController to keep the orchestrator under size limits.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { clampCollapsedComposerCursor } from '../../composer-logic'
import {
  hasServerAcknowledgedLocalDispatch,
  createLocalDispatchSnapshot,
  collectUserMessageBlobPreviewUrls,
  revokeUserMessagePreviewUrls,
  type LocalDispatchSnapshot,
} from '../ChatView.logic'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { useChatViewDerivedThread } from './useChatViewDerivedThread'
import type { useChatViewDerivedActivities } from './useChatViewDerivedActivities'
import type { useChatViewDerivedPlan } from './useChatViewDerivedPlan'
import type { useChatViewDerivedComposer } from './useChatViewDerivedComposer'
import type { ComposerImageAttachment, DraftThreadEnvMode } from '../../composerDraftStore'
import type { SessionPhase } from '../../types'

type L = ReturnType<typeof useChatViewLocalState>

// ---------------------------------------------------------------------------
// Local dispatch state
// ---------------------------------------------------------------------------

export function useLocalDispatchState(
  activeThread: Parameters<typeof createLocalDispatchSnapshot>[0],
  phase: SessionPhase,
  activeLatestTurn: Parameters<typeof hasServerAcknowledgedLocalDispatch>[0]['latestTurn'],
  activePendingApproval: { requestId: string } | null,
  activePendingUserInput: { requestId: string } | null,
  threadError: string | null | undefined
) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null)

  const beginLocalDispatch = useCallback(
    (options?: { preparingWorktree?: boolean }) => {
      const preparingWorktree = Boolean(options?.preparingWorktree)
      setLocalDispatch(current => {
        if (current)
          return current.preparingWorktree === preparingWorktree
            ? current
            : { ...current, preparingWorktree }
        return createLocalDispatchSnapshot(activeThread, options)
      })
    },
    [activeThread]
  )

  const resetLocalDispatch = useCallback(() => {
    setLocalDispatch(null)
  }, [])

  const serverAcknowledgedLocalDispatch = useMemo(
    () =>
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase,
        latestTurn: activeLatestTurn,
        session: activeThread?.session ?? null,
        hasPendingApproval: activePendingApproval !== null,
        hasPendingUserInput: activePendingUserInput !== null,
        threadError,
      }),
    [
      localDispatch,
      phase,
      activeLatestTurn,
      activeThread,
      activePendingApproval,
      activePendingUserInput,
      threadError,
    ]
  )

  useEffect(() => {
    if (serverAcknowledgedLocalDispatch) resetLocalDispatch()
  }, [resetLocalDispatch, serverAcknowledgedLocalDispatch])

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: localDispatch?.startedAt ?? null,
    isPreparingWorktree: localDispatch?.preparingWorktree ?? false,
    isSendBusy: localDispatch !== null && !serverAcknowledgedLocalDispatch,
  }
}

// ---------------------------------------------------------------------------
// Core effects — split into granular hooks
// ---------------------------------------------------------------------------

function useSyncRefsEffect(
  ls: L,
  prompt: string,
  composerImages: ComposerImageAttachment[],
  composerTerminalContexts: L['composerTerminalContextsRef']['current']
) {
  const {
    promptRef,
    setComposerCursor,
    composerImagesRef,
    composerTerminalContextsRef,
    optimisticUserMessages,
    optimisticUserMessagesRef,
  } = ls
  useEffect(() => {
    promptRef.current = prompt
    setComposerCursor(ex => clampCollapsedComposerCursor(prompt, ex))
  }, [prompt, promptRef, setComposerCursor])
  useEffect(() => {
    composerImagesRef.current = composerImages
  }, [composerImages, composerImagesRef])
  useEffect(() => {
    composerTerminalContextsRef.current = composerTerminalContexts
  }, [composerTerminalContexts, composerTerminalContextsRef])
  useEffect(() => {
    optimisticUserMessagesRef.current = optimisticUserMessages
  }, [optimisticUserMessages, optimisticUserMessagesRef])
}

function useSyncMenuRefsEffect(
  ls: L,
  composerMenuOpen: boolean,
  composerMenuItems: ReturnType<typeof useChatViewDerivedComposer>['composerMenuItems'],
  activeComposerMenuItem: ReturnType<typeof useChatViewDerivedComposer>['activeComposerMenuItem']
) {
  const { composerMenuOpenRef, composerMenuItemsRef, activeComposerMenuItemRef } = ls
  useEffect(() => {
    composerMenuOpenRef.current = composerMenuOpen
    composerMenuItemsRef.current = composerMenuItems
    activeComposerMenuItemRef.current = activeComposerMenuItem
  }, [
    activeComposerMenuItem,
    composerMenuItems,
    composerMenuOpen,
    composerMenuOpenRef,
    composerMenuItemsRef,
    activeComposerMenuItemRef,
  ])
}

function useResetOnThreadChangeEffect(ls: L, activeThreadId: string | null) {
  const {
    setExpandedWorkGroups,
    setPullRequestDialogState,
    planSidebarDismissedForTurnRef,
    setIsRevertingCheckpoint,
    dragDepthRef,
    setIsDragOverComposer,
    setQueuedComposerMessages,
    planSidebarOpenOnNextThreadRef,
    setPlanSidebarOpen,
  } = ls
  useEffect(() => {
    setExpandedWorkGroups({})
    setPullRequestDialogState(null)
    planSidebarDismissedForTurnRef.current = null
    setIsRevertingCheckpoint(false)
    dragDepthRef.current = 0
    setIsDragOverComposer(false)
    setQueuedComposerMessages([])
    if (planSidebarOpenOnNextThreadRef.current) {
      planSidebarOpenOnNextThreadRef.current = false
      setPlanSidebarOpen(true)
    } else {
      setPlanSidebarOpen(false)
    }
  }, [
    activeThreadId,
    dragDepthRef,
    planSidebarDismissedForTurnRef,
    planSidebarOpenOnNextThreadRef,
    setExpandedWorkGroups,
    setIsDragOverComposer,
    setIsRevertingCheckpoint,
    setQueuedComposerMessages,
    setPlanSidebarOpen,
    setPullRequestDialogState,
  ])
}

function useMenuHighlightEffect(
  ls: L,
  composerMenuOpen: boolean,
  composerMenuItems: ReturnType<typeof useChatViewDerivedComposer>['composerMenuItems'],
  composerHighlightedItemId: string | null
) {
  const { setComposerHighlightedItemId } = ls
  useEffect(() => {
    const nextHighlightedItemId = resolveComposerHighlightedItemId(
      composerMenuOpen,
      composerMenuItems,
      composerHighlightedItemId
    )
    if (nextHighlightedItemId === composerHighlightedItemId) {
      return
    }
    setComposerHighlightedItemId(nextHighlightedItemId)
  }, [composerHighlightedItemId, composerMenuItems, composerMenuOpen, setComposerHighlightedItemId])
}

export function resolveComposerHighlightedItemId(
  composerMenuOpen: boolean,
  composerMenuItems: ReadonlyArray<{ id: string }>,
  composerHighlightedItemId: string | null
): string | null {
  if (!composerMenuOpen) {
    return null
  }
  if (
    composerHighlightedItemId &&
    composerMenuItems.some(item => item.id === composerHighlightedItemId)
  ) {
    return composerHighlightedItemId
  }
  return composerMenuItems[0]?.id ?? null
}

function useFocusAndTickEffects(
  ls: L,
  activeThreadId: string | null,
  terminalOpen: boolean,
  focusComposer: () => void,
  phase: SessionPhase
) {
  const { setNowTick } = ls
  useEffect(() => {
    if (!activeThreadId || terminalOpen) return
    const frame = window.requestAnimationFrame(() => {
      focusComposer()
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [activeThreadId, focusComposer, terminalOpen])

  useEffect(() => {
    if (phase !== 'running') return
    const timer = window.setInterval(() => {
      setNowTick(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [phase, setNowTick])
}

export function useChatViewCoreEffects(args: {
  activeThreadId: string | null
  phase: SessionPhase
  composerImages: ComposerImageAttachment[]
  composerTerminalContexts: L['composerTerminalContextsRef']['current']
  composerMenuOpen: boolean
  composerMenuItems: ReturnType<typeof useChatViewDerivedComposer>['composerMenuItems']
  activeComposerMenuItem: ReturnType<typeof useChatViewDerivedComposer>['activeComposerMenuItem']
  ls: L
  prompt: string
  terminalOpen: boolean
  focusComposer: () => void
}) {
  useSyncRefsEffect(args.ls, args.prompt, args.composerImages, args.composerTerminalContexts)
  useSyncMenuRefsEffect(
    args.ls,
    args.composerMenuOpen,
    args.composerMenuItems,
    args.activeComposerMenuItem
  )
  useResetOnThreadChangeEffect(args.ls, args.activeThreadId)
  useMenuHighlightEffect(
    args.ls,
    args.composerMenuOpen,
    args.composerMenuItems,
    args.ls.composerHighlightedItemId
  )
  useFocusAndTickEffects(
    args.ls,
    args.activeThreadId,
    args.terminalOpen,
    args.focusComposer,
    args.phase
  )
}

export function useChatViewOptimisticMessageEffect(
  activeThreadId: string | null,
  serverMessages: Array<{ id: string }> | undefined,
  optimisticUserMessages: Array<{ id: string }>,
  setOptimisticUserMessages: React.Dispatch<
    React.SetStateAction<ReturnType<typeof useChatViewLocalState>['optimisticUserMessages']>
  >,
  handoffAttachmentPreviews: (messageId: string, previewUrls: string[]) => void
) {
  useEffect(() => {
    if (!activeThreadId || !serverMessages?.length) return
    const serverIds = new Set(serverMessages.map(m => m.id))
    const removed = optimisticUserMessages.filter(m => serverIds.has(m.id))
    if (removed.length === 0) return
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages(ex => ex.filter(m => !serverIds.has(m.id)))
    }, 0)
    for (const msg of removed) {
      const urls = collectUserMessageBlobPreviewUrls(
        msg as Parameters<typeof collectUserMessageBlobPreviewUrls>[0]
      )
      if (urls.length > 0) {
        handoffAttachmentPreviews(msg.id, urls)
        continue
      }
      revokeUserMessagePreviewUrls(msg as Parameters<typeof revokeUserMessagePreviewUrls>[0])
    }
    return () => {
      window.clearTimeout(timer)
    }
  }, [
    activeThreadId,
    serverMessages,
    optimisticUserMessages,
    setOptimisticUserMessages,
    handoffAttachmentPreviews,
  ])
}

// ---------------------------------------------------------------------------
// Env mode derivation + scroll input
// ---------------------------------------------------------------------------

export function deriveEnvMode(
  activeThread: { worktreePath?: string | null } | undefined,
  isLocalDraftThread: boolean,
  draftThreadEnvMode: DraftThreadEnvMode | null | undefined
): DraftThreadEnvMode {
  if (activeThread?.worktreePath) return 'worktree'
  if (isLocalDraftThread) return draftThreadEnvMode ?? 'local'
  return 'local'
}

export function deriveScrollInput(
  ad: ReturnType<typeof useChatViewDerivedActivities>,
  td: ReturnType<typeof useChatViewDerivedThread>,
  p: ReturnType<typeof useChatViewDerivedPlan>
) {
  return {
    activeThreadId: td.activeThreadId,
    messageCount: ad.timelineMessages.length,
    phase: td.phase,
    timelineEntriesLength: ad.timelineEntries.length,
    composerFooterActionLayoutKey: ad.activePendingProgress
      ? `pending:${ad.activePendingProgress.questionIndex}:${ad.activePendingProgress.isLastQuestion}`
      : td.phase === 'running'
        ? 'running'
        : 'idle',
    composerFooterHasWideActions: p.showPlanFollowUpPrompt || ad.activePendingProgress !== null,
  }
}
