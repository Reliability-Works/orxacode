/**
 * ChatView behavior hooks - Part 2:
 * Approval responses, pending user input, composer interactions,
 * provider/model selection, mode changes, project scripts, image expand, revert, interrupt.
 */

import { useCallback } from 'react'
import {
  type ModelSelection,
  type ProviderInteractionMode,
  type ProviderKind,
  type RuntimeMode,
  type ThreadId,
} from '@orxa-code/contracts'
import { newCommandId, randomUUID } from '~/lib/utils'
import { readNativeApi } from '~/nativeApi'
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  replaceTextRange,
} from '../../composer-logic'
import { toastManager } from '../ui/toastState'
import type { ComposerCommandItem } from './ComposerCommandMenu'
import type { ExpandedImagePreview } from './ExpandedImagePreview'
import type { DraftThreadEnvMode } from '../../composerDraftStore'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { useChatViewDerivedThread } from './useChatViewDerivedThread'
import type { useChatViewDerivedActivities } from './useChatViewDerivedActivities'
import type { useChatViewDerivedComposer } from './useChatViewDerivedComposer'

export {
  useApprovalCallbacks,
  usePendingUserInputCallbacks,
} from './useChatViewBehavior2.approvals'
export { useProviderModeCallbacks } from './useChatViewBehavior2.provider'
export { useProjectScriptCallbacks } from './useChatViewBehavior2.scripts'

type S = ReturnType<typeof useChatViewStoreSelectors>
type L = ReturnType<typeof useChatViewLocalState>
type T = ReturnType<typeof useChatViewDerivedThread>
type A = ReturnType<typeof useChatViewDerivedActivities>
type C = ReturnType<typeof useChatViewDerivedComposer>

// ---------------------------------------------------------------------------
// Persist thread settings
// ---------------------------------------------------------------------------

export function usePersistThreadSettings(store: S) {
  const { serverThread } = store
  return useCallback(
    async (input: {
      threadId: ThreadId
      createdAt: string
      modelSelection?: ModelSelection
      runtimeMode: RuntimeMode
      interactionMode: ProviderInteractionMode
    }) => {
      if (!serverThread) return
      const api = readNativeApi()
      if (!api) return
      if (input.modelSelection !== undefined) {
        const changed =
          input.modelSelection.model !== serverThread.modelSelection.model ||
          input.modelSelection.provider !== serverThread.modelSelection.provider ||
          JSON.stringify(input.modelSelection.options ?? null) !==
            JSON.stringify(serverThread.modelSelection.options ?? null)
        if (changed)
          await api.orchestration.dispatchCommand({
            type: 'thread.meta.update',
            commandId: newCommandId(),
            threadId: input.threadId,
            modelSelection: input.modelSelection,
          })
      }
      if (input.runtimeMode !== serverThread.runtimeMode)
        await api.orchestration.dispatchCommand({
          type: 'thread.runtime-mode.set',
          commandId: newCommandId(),
          threadId: input.threadId,
          runtimeMode: input.runtimeMode,
          createdAt: input.createdAt,
        })
      if (input.interactionMode !== serverThread.interactionMode)
        await api.orchestration.dispatchCommand({
          type: 'thread.interaction-mode.set',
          commandId: newCommandId(),
          threadId: input.threadId,
          interactionMode: input.interactionMode,
          createdAt: input.createdAt,
        })
    },
    [serverThread]
  )
}

// ---------------------------------------------------------------------------
// Composer interaction callbacks
// ---------------------------------------------------------------------------

function extendRangeForTrailingSpace(text: string, rangeEnd: number, replacement: string): number {
  if (!replacement.endsWith(' ')) return rangeEnd
  return text[rangeEnd] === ' ' ? rangeEnd + 1 : rangeEnd
}

function handleSlashCommandMenuSelection(args: {
  item: Extract<ComposerCommandItem, { type: 'slash-command' }>
  applyRangeReplacement: (replacement: string) => void
  clearComposerHighlight: () => boolean
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void
  setComposerHighlightedItemId: L['setComposerHighlightedItemId']
}) {
  if (args.item.command === 'model') {
    args.applyRangeReplacement('/model ')
    return
  }
  if (args.item.command === 'handoff' || args.item.command === 'fork') {
    args.applyRangeReplacement(`/${args.item.command} `)
    return
  }
  if (args.item.command === 'status') {
    args.applyRangeReplacement('/status')
    return
  }
  args.handleInteractionModeChange(args.item.command === 'plan' ? 'plan' : 'default')
  if (args.clearComposerHighlight()) {
    args.setComposerHighlightedItemId(null)
  }
}

export function useApplyPromptReplacement(ls: L, setPrompt: (s: string) => void) {
  const { composerEditorRef, promptRef, setComposerCursor, setComposerTrigger } = ls
  return useCallback(
    (
      rangeStart: number,
      rangeEnd: number,
      replacement: string,
      options?: { expectedText?: string }
    ): boolean => {
      const text = promptRef.current
      const safeStart = Math.max(0, Math.min(text.length, rangeStart))
      const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd))
      if (
        options?.expectedText !== undefined &&
        text.slice(safeStart, safeEnd) !== options.expectedText
      )
        return false
      const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement)
      const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor)
      promptRef.current = next.text
      setPrompt(next.text)
      setComposerCursor(nextCursor)
      setComposerTrigger(
        detectComposerTrigger(next.text, expandCollapsedComposerCursor(next.text, nextCursor))
      )
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor)
      })
      return true
    },
    [composerEditorRef, promptRef, setComposerCursor, setComposerTrigger, setPrompt]
  )
}

export function useReadComposerSnapshot(ls: L) {
  const { composerEditorRef, promptRef, composerCursor } = ls
  return useCallback(() => {
    const snap = composerEditorRef.current?.readSnapshot()
    if (snap) return snap
    return {
      value: promptRef.current,
      cursor: composerCursor,
      expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
      terminalContextIds: [] as string[],
    }
  }, [composerEditorRef, composerCursor, promptRef])
}

export function useNudgeComposerMenuHighlight(ls: L, c: C) {
  const { setComposerHighlightedItemId, composerHighlightedItemId } = ls
  const { composerMenuItems } = c
  return useCallback(
    (key: 'ArrowDown' | 'ArrowUp') => {
      if (composerMenuItems.length === 0) return
      const idx = composerMenuItems.findIndex(item => item.id === composerHighlightedItemId)
      const normalizedIdx = idx >= 0 ? idx : key === 'ArrowDown' ? -1 : 0
      const next =
        (normalizedIdx + (key === 'ArrowDown' ? 1 : -1) + composerMenuItems.length) %
        composerMenuItems.length
      setComposerHighlightedItemId(composerMenuItems[next]?.id ?? null)
    },
    [composerHighlightedItemId, composerMenuItems, setComposerHighlightedItemId]
  )
}

export function useOnSelectComposerItem(
  ls: L,
  applyPromptReplacement: (
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
    options?: { expectedText?: string }
  ) => boolean,
  readComposerSnapshot: () => {
    value: string
    cursor: number
    expandedCursor: number
    terminalContextIds: string[]
  },
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void,
  onProviderModelSelect: (provider: ProviderKind, model: string) => void
) {
  const { composerSelectLockRef, setComposerHighlightedItemId } = ls
  return useCallback(
    (item: ComposerCommandItem) => {
      if (composerSelectLockRef.current) return
      composerSelectLockRef.current = true
      window.requestAnimationFrame(() => {
        composerSelectLockRef.current = false
      })
      const { snapshot, trigger } = (() => {
        const snap = readComposerSnapshot()
        return { snapshot: snap, trigger: detectComposerTrigger(snap.value, snap.expandedCursor) }
      })()
      if (!trigger) return
      const applyRangeReplacement = (replacement: string) => {
        const end = extendRangeForTrailingSpace(snapshot.value, trigger.rangeEnd, replacement)
        if (
          applyPromptReplacement(trigger.rangeStart, end, replacement, {
            expectedText: snapshot.value.slice(trigger.rangeStart, end),
          })
        )
          setComposerHighlightedItemId(null)
      }
      const clearComposerHighlight = () =>
        applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, '', {
          expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
        })
      if (item.type === 'path') return void applyRangeReplacement(`@${item.path} `)
      if (item.type === 'skill') return void applyRangeReplacement(`@${item.skill.id} `)
      if (item.type === 'slash-command') {
        handleSlashCommandMenuSelection({
          item,
          applyRangeReplacement,
          clearComposerHighlight,
          handleInteractionModeChange,
          setComposerHighlightedItemId,
        })
        return
      }
      if (item.type === 'native-slash-command')
        return void applyRangeReplacement(`/${item.command} `)
      onProviderModelSelect(item.provider, item.model)
      if (clearComposerHighlight()) {
        setComposerHighlightedItemId(null)
      }
    },
    [
      applyPromptReplacement,
      composerSelectLockRef,
      handleInteractionModeChange,
      onProviderModelSelect,
      readComposerSnapshot,
      setComposerHighlightedItemId,
    ]
  )
}

// ---------------------------------------------------------------------------
// Image expand + navigate
// ---------------------------------------------------------------------------

export function useImageExpandCallbacks(ls: L) {
  const { setExpandedImage } = ls

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null)
  }, [setExpandedImage])
  const navigateExpandedImage = useCallback(
    (direction: -1 | 1) => {
      setExpandedImage(existing => {
        if (!existing || existing.images.length <= 1) return existing
        const nextIndex =
          (existing.index + direction + existing.images.length) % existing.images.length
        return nextIndex === existing.index ? existing : { ...existing, index: nextIndex }
      })
    },
    [setExpandedImage]
  )
  const onExpandTimelineImage = useCallback(
    (preview: ExpandedImagePreview) => {
      setExpandedImage(preview)
    },
    [setExpandedImage]
  )

  return { closeExpandedImage, navigateExpandedImage, onExpandTimelineImage }
}

// ---------------------------------------------------------------------------
// Revert + interrupt
// ---------------------------------------------------------------------------

export function useRevertAndInterruptCallbacks(
  td: T,
  ad: A,
  setThreadError: (id: ThreadId | null, error: string | null) => void,
  ls: L
) {
  const { activeThread, phase } = td
  const { isRevertingCheckpoint, setIsRevertingCheckpoint } = ls

  void ad

  const onRevertToTurnCount = useCallback(
    async (turnCount: number) => {
      const api = readNativeApi()
      if (!api || !activeThread || isRevertingCheckpoint) return
      if (phase === 'running') {
        setThreadError(activeThread.id, 'Interrupt the current turn before reverting checkpoints.')
        return
      }
      const confirmed = await api.dialogs.confirm(
        [
          `Revert this thread to checkpoint ${turnCount}?`,
          'This will discard newer messages and turn diffs in this thread.',
          'This action cannot be undone.',
        ].join('\n')
      )
      if (!confirmed) return
      setIsRevertingCheckpoint(true)
      setThreadError(activeThread.id, null)
      try {
        await api.orchestration.dispatchCommand({
          type: 'thread.checkpoint.revert',
          commandId: newCommandId(),
          threadId: activeThread.id,
          turnCount,
          createdAt: new Date().toISOString(),
        })
      } catch (err) {
        setThreadError(
          activeThread.id,
          err instanceof Error ? err.message : 'Failed to revert thread state.'
        )
      }
      setIsRevertingCheckpoint(false)
    },
    [activeThread, isRevertingCheckpoint, phase, setIsRevertingCheckpoint, setThreadError]
  )

  const onInterrupt = useCallback(async () => {
    const api = readNativeApi()
    if (!api || !activeThread) return
    await api.orchestration.dispatchCommand({
      type: 'thread.turn.interrupt',
      commandId: newCommandId(),
      threadId: activeThread.id,
      createdAt: new Date().toISOString(),
    })
  }, [activeThread])

  return { onRevertToTurnCount, onInterrupt }
}

// ---------------------------------------------------------------------------
// Git sidebar
// ---------------------------------------------------------------------------

export function useGitSidebarCallbacks(ls: L) {
  const openGitSidebar = useCallback(() => {
    ls.setAuxSidebarMode('git')
  }, [ls])

  return { openGitSidebar }
}

// ---------------------------------------------------------------------------
// Env mode + traits prompt
// ---------------------------------------------------------------------------

export function useEnvModeAndTraitsCallbacks(
  threadId: ThreadId,
  store: S,
  td: T,
  ls: L,
  setPrompt: (s: string) => void,
  scheduleComposerFocus: () => void
) {
  const { setDraftThreadContext, setThreadEnvMode } = store
  const { isLocalDraftThread } = td
  const { setComposerCursor, setComposerTrigger } = ls
  const prompt = store.composerDraft.prompt

  const onEnvModeChange = useCallback(
    (mode: DraftThreadEnvMode) => {
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { envMode: mode })
      } else {
        setThreadEnvMode(threadId, mode)
      }
      scheduleComposerFocus()
    },
    [isLocalDraftThread, scheduleComposerFocus, setDraftThreadContext, setThreadEnvMode, threadId]
  )

  const setPromptFromTraits = useCallback(
    (nextPrompt: string) => {
      if (nextPrompt === prompt) {
        scheduleComposerFocus()
        return
      }
      setPrompt(nextPrompt)
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length)
      setComposerCursor(nextCursor)
      setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length))
      scheduleComposerFocus()
    },
    [prompt, scheduleComposerFocus, setComposerCursor, setComposerTrigger, setPrompt]
  )

  return { onEnvModeChange, setPromptFromTraits }
}

// ---------------------------------------------------------------------------
// Work group toggle
// ---------------------------------------------------------------------------

export function useWorkGroupCallbacks(ls: L) {
  const { setExpandedWorkGroups } = ls
  const onToggleWorkGroup = useCallback(
    (groupId: string) => {
      setExpandedWorkGroups(ex => ({ ...ex, [groupId]: !ex[groupId] }))
    },
    [setExpandedWorkGroups]
  )
  return { onToggleWorkGroup }
}

// ---------------------------------------------------------------------------
// Add composer images from files
// ---------------------------------------------------------------------------

const IMAGE_SIZE_LIMIT_LABEL = `${Math.round((import('@orxa-code/contracts').then(() => 0) as unknown as number) / (1024 * 1024))}MB`

export type AddComposerImagesParams = {
  activeThreadId: ThreadId | null
  pendingUserInputsLength: number
  composerImagesLength: number
  addComposerImage: (img: import('../../composerDraftStore').ComposerImageAttachment) => void
  addComposerImagesToDraft: (
    imgs: import('../../composerDraftStore').ComposerImageAttachment[]
  ) => void
  setThreadError: (id: ThreadId | null, error: string | null) => void
  maxAttachments: number
  maxImageBytes: number
}

export function buildComposerImages(files: File[], params: AddComposerImagesParams): void {
  if (!params.activeThreadId || files.length === 0) return
  if (params.pendingUserInputsLength > 0) {
    toastManager.add({ type: 'error', title: 'Attach images after answering plan questions.' })
    return
  }
  const nextImages: import('../../composerDraftStore').ComposerImageAttachment[] = []
  let nextCount = params.composerImagesLength
  let error: string | null = null
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      error = `Unsupported file type for '${file.name}'. Please attach image files only.`
      continue
    }
    if (file.size > params.maxImageBytes) {
      error = `'${file.name}' exceeds the attachment limit.`
      continue
    }
    if (nextCount >= params.maxAttachments) {
      error = `You can attach up to ${params.maxAttachments} images per message.`
      break
    }
    nextImages.push({
      type: 'image',
      id: randomUUID(),
      name: file.name || 'image',
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: URL.createObjectURL(file),
      file,
    })
    nextCount += 1
  }
  if (nextImages.length === 1 && nextImages[0]) params.addComposerImage(nextImages[0])
  else if (nextImages.length > 1) params.addComposerImagesToDraft(nextImages)
  params.setThreadError(params.activeThreadId, error)
}

void IMAGE_SIZE_LIMIT_LABEL
